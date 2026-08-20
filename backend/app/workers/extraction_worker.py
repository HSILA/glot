"""
Extraction workers for ARQ background jobs.

Architecture:
- prepare_extraction: Coordinator job (ensure metadata, render missing PNGs, queue page jobs)
- extract_page: Processes a single page (atomic, retryable)
- check_stale_extractions: Re-queue stuck pages (run at worker startup)
- check_orphan_resources: Fix resources stuck in PROCESSING (run at worker startup)
- recover_incomplete_extractions: Startup recovery for incomplete processing resources
- sweep_expired_uploads: Reclaim abandoned, never-confirmed uploads (run at worker startup)

Recovery is cronless: there is no periodic DB polling. Recovery runs once at
worker startup, and otherwise on-demand when the frontend resumes a resource
(see resources API). Deterministic ARQ job ids dedupe re-queued work.

Run with:
    arq app.workers.extraction_worker.WorkerSettings
"""

import io
from datetime import timedelta

import fitz  # PyMuPDF
from loguru import logger
from PIL import Image
from sqlalchemy import delete, func, select

from app.agents import ExtractionAgent
from app.api.v1.resources import UPLOAD_URL_EXPIRES_SECONDS, _staging_upload_key
from app.core import get_settings
from app.core.app_config import get_app_config
from app.core.datetime_utils import utc_now
from app.db import async_session_factory
from app.models import PageExtraction, PageStatus, Resource, UserResource
from app.models.resource import ExtractionStatus
from app.services import RedisService, StorageService

# Bound how many abandoned upload reservations a single sweeper run reclaims,
# so a large backlog never holds the row locks (or the startup) indefinitely.
_SWEEP_BATCH_LIMIT = 200

# Storage prefix holding per-resource staging objects (uploads/{id}.pdf).
_STAGING_PREFIX = "uploads"


def _staging_key_resource_id(key: str) -> int | None:
    """Extract the resource id from a staging key like ``uploads/7.pdf``."""
    if not key.startswith(_STAGING_PREFIX + "/"):
        return None
    stem = key[len(_STAGING_PREFIX) + 1 :]
    if not stem.endswith(".pdf"):
        return None
    try:
        return int(stem[: -len(".pdf")])
    except ValueError:
        return None


def _prepare_job_id(resource_id: int) -> str:
    """Deterministic ARQ job id for a resource's prepare job (dedupe signal)."""
    return f"glot:prepare:{resource_id}"


def _extract_page_job_id(resource_id: int, page_number: int) -> str:
    """Deterministic ARQ job id for a single page job (dedupe signal)."""
    return f"glot:extract:{resource_id}:{page_number}"


async def _render_page_to_temp(
    storage: StorageService,
    resource: Resource,
    page_number: int,
    *,
    dpi: int = 200,
) -> None:
    """Render a single PDF page to temp storage (1-indexed page number)."""
    pdf_bytes = await storage.async_download_file(resource.content_hash, folder="raw")
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    try:
        total_pages = len(doc)
        if page_number < 1 or page_number > total_pages:
            raise ValueError(
                f"Page {page_number} out of range for resource {resource.id} ({total_pages} pages)"
            )

        page = doc[page_number - 1]
        pix = page.get_pixmap(dpi=dpi)
        await storage.async_upload_file(
            pix.tobytes("png"),
            f"temp/{resource.content_hash}/page_{page_number}.png",
            folder=None,
            content_type="image/png",
        )
    finally:
        doc.close()


async def _ensure_thumbnail(
    storage: StorageService,
    resource: Resource,
    doc: fitz.Document,
) -> None:
    """Create thumbnail if missing."""
    if await storage.async_file_exists(resource.content_hash, folder="thumbnails"):
        return

    if len(doc) == 0:
        return

    first_page = doc[0]
    pix = first_page.get_pixmap(dpi=150)
    img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
    img.thumbnail((400, 600), Image.Resampling.LANCZOS)

    thumbnail_buffer = io.BytesIO()
    img.save(thumbnail_buffer, format="WEBP", quality=85)
    await storage.async_upload_thumbnail(thumbnail_buffer.getvalue(), resource.content_hash)


async def _safe_cleanup_temp_folder(storage: StorageService, content_hash: str) -> None:
    """Delete temp folder best-effort."""
    try:
        await storage.async_delete_temp_folder(content_hash)
    except Exception as e:
        logger.warning(f"Failed to clean temp folder for {content_hash}: {e}")


def _get_or_init_worker_settings(ctx: dict):
    """Get cached settings from worker ctx, initializing if needed."""
    settings = ctx.get("settings")
    if settings is None:
        settings = get_settings()
        ctx["settings"] = settings
    return settings


def _get_or_init_storage(ctx: dict) -> StorageService:
    """Get cached storage service from worker ctx, initializing if needed."""
    storage = ctx.get("storage")
    if storage is None:
        storage = StorageService(_get_or_init_worker_settings(ctx))
        ctx["storage"] = storage
    return storage


async def _get_or_init_redis(ctx: dict) -> RedisService:
    """Get cached Redis service from worker ctx, initializing if needed."""
    redis = ctx.get("redis")
    if redis is None:
        settings = _get_or_init_worker_settings(ctx)
        redis = RedisService(settings.redis_url)
        await redis.connect()
        ctx["redis"] = redis
    return redis


def _get_or_init_extraction_agent(ctx: dict) -> ExtractionAgent:
    """Get cached extraction agent from worker ctx, initializing if needed."""
    agent = ctx.get("extraction_agent")
    if agent is None:
        settings = _get_or_init_worker_settings(ctx)
        agent = ExtractionAgent(
            api_key=settings.openrouter_api_key,
            model_id=get_app_config().extraction.agent_model,
        )
        ctx["extraction_agent"] = agent
    return agent


async def prepare_extraction(ctx: dict, resource_id: int) -> dict:
    """
    Prepare a resource for page-by-page extraction.

    Idempotent behavior:
    - Ensures authoritative page_count exists
    - Ensures PageExtraction rows exist for pages 1..N
    - Ensures missing temp page images are rendered
    - Queues only incomplete pages
    """
    storage = _get_or_init_storage(ctx)
    redis = await _get_or_init_redis(ctx)

    logger.info(f"Preparing extraction for resource {resource_id}")

    async with async_session_factory() as session:
        doc: fitz.Document | None = None
        try:
            resource = await session.get(Resource, resource_id)
            if not resource:
                logger.error(f"Resource {resource_id} not found")
                return {"success": False, "error": "Resource not found"}

            if not resource.upload_confirmed:
                logger.error(f"Resource {resource_id} upload is not confirmed")
                return {"success": False, "error": "Upload not confirmed"}

            resource.extraction_status = ExtractionStatus.PROCESSING
            await session.flush()

            # Ensure page_count exists (authoritative backend value)
            total_pages = resource.page_count or 0
            pdf_bytes: bytes | None = None

            if total_pages <= 0:
                try:
                    pdf_bytes = await storage.async_download_file(
                        resource.content_hash,
                        folder="raw",
                    )
                except Exception as e:
                    logger.error(f"Failed to download PDF for page_count: {e}")
                    resource.extraction_status = ExtractionStatus.FAILED
                    await session.commit()
                    return {"success": False, "error": f"Download failed: {e}"}

                doc = fitz.open(stream=pdf_bytes, filetype="pdf")
                total_pages = len(doc)
                resource.page_count = total_pages
                await session.flush()

            if total_pages <= 0:
                resource.extraction_status = ExtractionStatus.FAILED
                await session.commit()
                return {"success": False, "error": "Resource has no pages"}

            # Ensure page tracking rows exist for all pages
            existing_rows_result = await session.execute(
                select(PageExtraction).where(PageExtraction.resource_id == resource_id)
            )
            existing_pages = {
                page.page_number: page for page in existing_rows_result.scalars().all()
            }

            for page_num in range(1, total_pages + 1):
                if page_num not in existing_pages:
                    session.add(
                        PageExtraction(
                            resource_id=resource_id,
                            page_number=page_num,
                            status=PageStatus.PENDING,
                        )
                    )

            await session.flush()

            # Ensure thumbnail exists
            if not await storage.async_file_exists(resource.content_hash, folder="thumbnails"):
                if doc is None:
                    if pdf_bytes is None:
                        pdf_bytes = await storage.async_download_file(
                            resource.content_hash,
                            folder="raw",
                        )
                    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
                try:
                    await _ensure_thumbnail(storage, resource, doc)
                except Exception as e:
                    logger.warning(f"Failed to generate thumbnail for resource {resource_id}: {e}")

            # Ensure all temp page images exist (cache fill, no folder_exists shortcut)
            missing_pages: list[int] = []
            for page_num in range(1, total_pages + 1):
                page_key = f"temp/{resource.content_hash}/page_{page_num}.png"
                if not await storage.async_file_exists(page_key, folder=None):
                    missing_pages.append(page_num)

            if missing_pages:
                if doc is None:
                    if pdf_bytes is None:
                        pdf_bytes = await storage.async_download_file(
                            resource.content_hash,
                            folder="raw",
                        )
                    doc = fitz.open(stream=pdf_bytes, filetype="pdf")

                logger.info(
                    f"Rendering {len(missing_pages)} missing pages for resource {resource_id}"
                )
                for page_num in missing_pages:
                    page = doc[page_num - 1]
                    pix = page.get_pixmap(dpi=200)
                    await storage.async_upload_file(
                        pix.tobytes("png"),
                        f"temp/{resource.content_hash}/page_{page_num}.png",
                        folder=None,
                        content_type="image/png",
                    )

            # Queue all non-completed pages
            incomplete_result = await session.execute(
                select(PageExtraction).where(
                    PageExtraction.resource_id == resource_id,
                    PageExtraction.status != PageStatus.COMPLETED,
                )
            )
            incomplete_pages = incomplete_result.scalars().all()

            queued = 0
            for page in incomplete_pages:
                if page.status == PageStatus.PROCESSING:
                    page.status = PageStatus.PENDING

                job_id = await redis.enqueue_job(
                    "extract_page",
                    resource_id,
                    page.page_number,
                    _job_id=_extract_page_job_id(resource_id, page.page_number),
                )
                if job_id:
                    queued += 1

            if not incomplete_pages:
                resource.extraction_status = ExtractionStatus.COMPLETED
                resource.processed_at = utc_now()
                await _safe_cleanup_temp_folder(storage, resource.content_hash)

            await session.commit()

            completed_count = total_pages - len(incomplete_pages)
            progress = int(completed_count / total_pages * 100) if total_pages else 0
            await redis.set_progress(
                resource_id,
                status="completed" if completed_count == total_pages else "processing",
                progress=progress,
                current_page=completed_count,
                total_pages=total_pages,
            )

            logger.info(
                f"Prepared resource {resource_id}: total_pages={total_pages}, missing_png={len(missing_pages)}, queued={queued}"
            )
            return {
                "success": True,
                "queued": queued,
                "total_pages": total_pages,
                "missing_pages_rendered": len(missing_pages),
            }

        except Exception as e:
            logger.exception(f"Prepare extraction failed for resource {resource_id}: {e}")
            return {"success": False, "error": str(e)}
        finally:
            if doc is not None:
                try:
                    doc.close()
                except Exception as e:
                    logger.warning(f"Failed to close PDF document for resource {resource_id}: {e}")


async def extract_page(ctx: dict, resource_id: int, page_number: int) -> dict:
    """
    Extract text from a single page.

    This is atomic and retryable. On failure, increments attempt count.
    """
    storage = _get_or_init_storage(ctx)
    redis = await _get_or_init_redis(ctx)

    logger.info(f"Extracting page {page_number} for resource {resource_id}")

    async with async_session_factory() as session:
        try:
            result = await session.execute(
                select(PageExtraction).where(
                    PageExtraction.resource_id == resource_id,
                    PageExtraction.page_number == page_number,
                )
            )
            page = result.scalar_one_or_none()

            if not page:
                logger.error(
                    f"Page record not found: resource={resource_id}, page={page_number}"
                )
                return {"success": False, "error": "Page record not found"}

            if page.status == PageStatus.COMPLETED:
                logger.info(f"Page {page_number} already completed, skipping")
                return {"success": True, "skipped": True}

            resource = await session.get(Resource, resource_id)
            if not resource:
                return {"success": False, "error": "Resource not found"}

            page.status = PageStatus.PROCESSING
            page.started_at = utc_now()
            page.attempts += 1
            await session.flush()

            temp_path = f"temp/{resource.content_hash}/page_{page_number}.png"
            png_bytes: bytes | None = None

            try:
                png_bytes = await storage.async_download_file(temp_path, folder=None)
            except Exception:
                # Self-healing fallback: render missing page image on demand.
                try:
                    await _render_page_to_temp(storage, resource, page_number)
                    png_bytes = await storage.async_download_file(temp_path, folder=None)
                except Exception as render_error:
                    # If markdown already exists, mark complete and recover.
                    try:
                        processed_path = (
                            f"processed/{resource.content_hash}/page_{page_number:04d}.md"
                        )
                        existing_markdown = await storage.async_download_file(
                            processed_path,
                            folder=None,
                        )
                        if existing_markdown:
                            page.status = PageStatus.COMPLETED
                            page.completed_at = utc_now()
                            page.last_error = None
                            await session.flush()
                            completed_now = await _update_resource_progress(
                                session,
                                redis,
                                resource_id,
                            )
                            await session.commit()
                            if completed_now:
                                await _safe_cleanup_temp_folder(
                                    storage,
                                    resource.content_hash,
                                )
                            return {
                                "success": True,
                                "page": page_number,
                                "recovered": True,
                            }
                    except Exception:
                        pass

                    page.last_error = f"Failed to prepare page image: {render_error}"
                    page.status = PageStatus.PENDING
                    await session.commit()
                    return {"success": False, "error": str(render_error)}

            agent = _get_or_init_extraction_agent(ctx)
            result = agent.extract_page(png_bytes, page_number)

            if result.success:
                await storage.async_upload_processed_page(
                    result.markdown,
                    resource.content_hash,
                    page_number,
                )

                page.status = PageStatus.COMPLETED
                page.completed_at = utc_now()
                page.last_error = None

                logger.info(
                    f"Extracted page {page_number} for resource {resource_id}: {len(result.markdown)} chars"
                )
            else:
                page.status = PageStatus.PENDING
                page.last_error = result.error
                logger.warning(f"Page {page_number} extraction failed: {result.error}")

            await session.flush()
            completed_now = await _update_resource_progress(session, redis, resource_id)
            await session.commit()

            if result.success:
                try:
                    await storage.async_delete_file(temp_path, folder=None)
                except Exception as e:
                    logger.warning(f"Failed to delete temp file {temp_path}: {e}")

                if completed_now:
                    await _safe_cleanup_temp_folder(storage, resource.content_hash)

            return {"success": result.success, "page": page_number}

        except Exception as e:
            logger.exception(
                f"Error extracting page {page_number} for resource {resource_id}: {e}"
            )

            result = await session.execute(
                select(PageExtraction).where(
                    PageExtraction.resource_id == resource_id,
                    PageExtraction.page_number == page_number,
                )
            )
            page = result.scalar_one_or_none()
            if page:
                page.status = PageStatus.PENDING
                page.last_error = str(e)[:1000]
                await session.commit()

            return {"success": False, "error": str(e)}


async def _update_resource_progress(
    session,
    redis: RedisService,
    resource_id: int,
) -> bool:
    """Update resource progress based on completed pages.

    Returns:
        True if resource transitioned to COMPLETED during this call.
    """
    total_result = await session.execute(
        select(func.count()).where(PageExtraction.resource_id == resource_id)
    )
    total = total_result.scalar() or 0

    completed_result = await session.execute(
        select(func.count()).where(
            PageExtraction.resource_id == resource_id,
            PageExtraction.status == PageStatus.COMPLETED,
        )
    )
    completed = completed_result.scalar() or 0

    progress = int(completed / total * 100) if total else 0
    is_completed = completed == total and total > 0

    await redis.set_progress(
        resource_id,
        status="completed" if is_completed else "processing",
        progress=progress,
        current_page=completed,
        total_pages=total,
    )

    completed_now = False
    if is_completed:
        resource = await session.get(Resource, resource_id)
        if resource and resource.extraction_status != ExtractionStatus.COMPLETED:
            resource.extraction_status = ExtractionStatus.COMPLETED
            resource.processed_at = utc_now()
            completed_now = True
            logger.info(f"Extraction completed for resource {resource_id}")

    return completed_now


async def check_stale_extractions(ctx: dict):
    """
    Recovery helper: find stuck extractions and re-queue them.

    A page is considered stuck if:
    - Status is PROCESSING
    - Started more than 5 minutes ago
    """
    redis = await _get_or_init_redis(ctx)

    stale_threshold = utc_now() - timedelta(minutes=5)

    logger.info("Checking for stale extractions...")

    async with async_session_factory() as session:
        try:
            # Find stuck pages
            result = await session.execute(
                select(PageExtraction).where(
                    PageExtraction.status == PageStatus.PROCESSING,
                    PageExtraction.started_at < stale_threshold,
                )
            )
            stuck_pages = result.scalars().all()

            if not stuck_pages:
                logger.info("No stale extractions found")
                return {"requeued": 0}

            # Re-queue each stuck page
            requeued = 0
            for page in stuck_pages:
                page.status = PageStatus.PENDING
                job_id = await redis.enqueue_job(
                    "extract_page",
                    page.resource_id,
                    page.page_number,
                    _job_id=_extract_page_job_id(page.resource_id, page.page_number),
                )
                if job_id:
                    requeued += 1
                    logger.info(
                        f"Re-queued stuck page: resource={page.resource_id}, page={page.page_number}"
                    )

            await session.commit()

            logger.info(f"Re-queued {requeued} stuck pages")
            return {"requeued": requeued}

        except Exception as e:
            logger.exception(f"Error checking stale extractions: {e}")
            return {"error": str(e)}


async def check_orphan_resources(ctx: dict):
    """
    Recovery helper: fix resources stuck in PROCESSING when all pages are done.

    This can happen if a worker crashes between updating page statuses
    and updating the parent resource status.
    """
    redis = await _get_or_init_redis(ctx)
    storage = _get_or_init_storage(ctx)

    logger.info("Checking for orphan resources...")

    async with async_session_factory() as session:
        try:
            result = await session.execute(
                select(Resource).where(
                    Resource.extraction_status == ExtractionStatus.PROCESSING
                )
            )
            processing_resources = result.scalars().all()

            if not processing_resources:
                logger.info("No processing resources found")
                return {"fixed": 0}

            fixed = 0
            for resource in processing_resources:
                total_result = await session.execute(
                    select(func.count()).where(PageExtraction.resource_id == resource.id)
                )
                total = total_result.scalar() or 0

                completed_result = await session.execute(
                    select(func.count()).where(
                        PageExtraction.resource_id == resource.id,
                        PageExtraction.status == PageStatus.COMPLETED,
                    )
                )
                completed = completed_result.scalar() or 0

                if total > 0 and completed == total:
                    resource.extraction_status = ExtractionStatus.COMPLETED
                    resource.processed_at = utc_now()
                    fixed += 1
                    await _safe_cleanup_temp_folder(storage, resource.content_hash)
                    logger.info(
                        f"Fixed orphan resource {resource.id}: all {total} pages completed"
                    )

                    await redis.set_progress(
                        resource.id,
                        status="completed",
                        progress=100,
                        current_page=total,
                        total_pages=total,
                    )

            await session.commit()
            logger.info(f"Fixed {fixed} orphan resources")
            return {"fixed": fixed}

        except Exception as e:
            logger.exception(f"Error checking orphan resources: {e}")
            return {"error": str(e)}


async def recover_incomplete_extractions(ctx: dict):
    """
    Recover resources in PROCESSING state with incomplete work.

    Recovery conditions:
    - Missing page_count
    - Missing page_extractions rows for page_count
    - Any page row not COMPLETED
    """
    redis = await _get_or_init_redis(ctx)

    logger.info("Recovering incomplete extractions...")

    async with async_session_factory() as session:
        try:
            result = await session.execute(
                select(Resource).where(
                    Resource.extraction_status == ExtractionStatus.PROCESSING
                )
            )
            processing_resources = result.scalars().all()

            if not processing_resources:
                logger.info("No incomplete extractions found")
                return {"recovered": 0}

            recovered = 0
            for resource in processing_resources:
                total_pages = resource.page_count or 0

                total_rows_result = await session.execute(
                    select(func.count()).where(PageExtraction.resource_id == resource.id)
                )
                total_rows = total_rows_result.scalar() or 0

                incomplete_rows_result = await session.execute(
                    select(func.count()).where(
                        PageExtraction.resource_id == resource.id,
                        PageExtraction.status != PageStatus.COMPLETED,
                    )
                )
                incomplete_rows = incomplete_rows_result.scalar() or 0

                needs_recovery = (
                    total_pages <= 0
                    or total_rows == 0
                    or (total_pages > 0 and total_rows < total_pages)
                    or incomplete_rows > 0
                )

                if not needs_recovery:
                    continue

                job_id = await redis.enqueue_job(
                    "prepare_extraction",
                    resource.id,
                    _job_id=_prepare_job_id(resource.id),
                )
                if job_id:
                    recovered += 1
                    logger.info(
                        f"Queued recovery prepare job for resource {resource.id}"
                    )

            logger.info(f"Recovered {recovered} incomplete extractions")
            return {"recovered": recovered}

        except Exception as e:
            logger.exception(f"Error recovering incomplete extractions: {e}")
            return {"error": str(e)}


async def sweep_expired_uploads(ctx: dict):
    """Reclaim abandoned upload artifacts whose reservation expired long ago.

    Two kinds of garbage:

    1. Never-confirmed uploads: the file was never uploaded, or was uploaded
       but never confirmed, within the presigned-URL window plus a grace period.
       These are unreachable (URL is dead, ownership has lapsed) so we delete
       the staging object and the DB rows.

    2. Staging objects left behind on confirmed resources: after a successful
       confirm the staging key ``uploads/{id}.pdf`` is never used again, but a
       transient delete failure at confirm time can leave it behind. These are
       always safe to delete once the original URL window has fully passed.

    The raw/ + thumbnail content-addressed objects are intentionally left alone
    here: they are keyed by content hash and reused by any future upload of the
    same content, so they are not pure garbage and require a reference-count
    check before deletion (tracked as a follow-up).

    Runs once at worker startup (cronless - no periodic DB polling).
    """
    storage = _get_or_init_storage(ctx)

    logger.info("Sweeping expired upload reservations...")

    async with async_session_factory() as session:
        try:
            grace = get_app_config().resources.abandoned_upload_grace_seconds
            cutoff = utc_now() - timedelta(
                seconds=UPLOAD_URL_EXPIRES_SECONDS + grace
            )

            # 1. Reclaim never-confirmed reservations. Commit (even when nothing
            #    was swept) so the FOR UPDATE locks are released before any R2
            #    network I/O below.
            result = await session.execute(
                select(Resource)
                .where(
                    Resource.upload_confirmed == False,  # noqa: E712
                    Resource.uploaded_at < cutoff,
                )
                .with_for_update(skip_locked=True)
                .limit(_SWEEP_BATCH_LIMIT)
            )
            expired = result.scalars().all()

            swept = 0
            for resource in expired:
                # A confirm starting just before us holds the row lock, so it
                # is skipped here; re-check to avoid racing on the refreshed row.
                if resource.upload_confirmed:
                    continue
                try:
                    await storage.async_delete_file(
                        _staging_upload_key(resource.id),
                        folder=None,
                    )
                except Exception as e:
                    # Leave the row so a later sweep retries the object; deleting
                    # the row now would orphan the object unreachably in storage.
                    logger.warning(
                        f"Skipping expired upload {resource.id}: "
                        f"staging delete failed: {e}"
                    )
                    continue
                await session.execute(
                    delete(UserResource).where(
                        UserResource.resource_id == resource.id
                    )
                )
                await session.delete(resource)
                swept += 1
                logger.info(f"Swept expired upload reservation {resource.id}")

            await session.commit()

            # 2. Clean leftover staging objects on CONFIRMED resources by
            #    enumerating what actually exists in storage (the source of
            #    truth), so we make progress and only count real deletions.
            staging_cleaned = 0
            try:
                keys = await storage.async_list_object_keys(
                    _STAGING_PREFIX, limit=_SWEEP_BATCH_LIMIT
                )
            except Exception as e:
                logger.warning(f"Failed to list staging objects: {e}")
                keys = []

            for key in keys:
                resource_id = _staging_key_resource_id(key)
                if resource_id is None:
                    continue
                row = await session.get(Resource, resource_id)
                # Safe to delete staging when the row is gone (orphan) or the
                # resource is confirmed (staging is never needed again) and old.
                if row is None or (
                    row.upload_confirmed and row.uploaded_at < cutoff
                ):
                    try:
                        await storage.async_delete_file(key, folder=None)
                        staging_cleaned += 1
                    except Exception as e:
                        logger.warning(
                            f"Failed to clean staging {key}: {e}"
                        )

            logger.info(
                f"Swept {swept} expired reservations, "
                f"cleaned {staging_cleaned} leftover staging objects"
            )
            return {"swept": swept, "staging_cleaned": staging_cleaned}
        except Exception as e:
            logger.exception(f"Error sweeping expired uploads: {e}")
            return {"error": str(e)}


async def on_worker_startup(ctx: dict):
    """Initialize shared worker services and run recovery checks."""
    logger.info("Worker startup: initializing shared services...")

    _get_or_init_worker_settings(ctx)
    await _get_or_init_redis(ctx)
    _get_or_init_storage(ctx)
    _get_or_init_extraction_agent(ctx)

    logger.info("Worker startup: running recovery checks...")

    stale_result = await check_stale_extractions(ctx)
    logger.info(f"Stale extractions check: {stale_result}")

    orphan_result = await check_orphan_resources(ctx)
    logger.info(f"Orphan resources check: {orphan_result}")

    incomplete_result = await recover_incomplete_extractions(ctx)
    logger.info(f"Incomplete extractions check: {incomplete_result}")

    upload_result = await sweep_expired_uploads(ctx)
    logger.info(f"Expired upload sweep: {upload_result}")

    logger.info("Worker startup recovery complete")


async def on_worker_shutdown(ctx: dict):
    """Close shared worker resources."""
    redis = ctx.get("redis")
    if redis is not None:
        try:
            await redis.close()
        finally:
            ctx.pop("redis", None)

    ctx.pop("extraction_agent", None)
    ctx.pop("storage", None)
    ctx.pop("settings", None)


def _get_worker_redis_settings():
    """Get Redis settings for worker initialization."""
    settings = get_settings()
    redis = RedisService(settings.redis_url)
    return redis.redis_settings


class WorkerSettings:
    """ARQ worker for extraction orchestration and page processing jobs."""

    functions = [prepare_extraction, extract_page]
    on_startup = on_worker_startup
    on_shutdown = on_worker_shutdown
    # No cron_jobs: recovery is cronless (runs at startup + on-demand resume).
    # This avoids periodic DB polling while the queue is idle.
    redis_settings = _get_worker_redis_settings()
    queue_name = "glot:extraction_queue"
    max_jobs = 4
    # Per-job retry/timeout bounds. Jobs are idempotent, so retries are safe.
    max_tries = 3
    job_timeout = 1200
    keep_result = 0
    health_check_interval = 600
    poll_delay = get_app_config().extraction.worker_poll_delay_seconds
