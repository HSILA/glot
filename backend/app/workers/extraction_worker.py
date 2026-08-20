"""
Extraction workers for ARQ background jobs.

Architecture:
- prepare_extraction: Coordinator job (ensure metadata, render missing PNGs, queue page jobs)
- extract_page: Processes a single page (atomic, retryable)
- check_stale_extractions: Re-queue stuck pages (run at worker startup)
- check_orphan_resources: Fix resources stuck in PROCESSING (run at worker startup)
- recover_incomplete_extractions: Startup recovery for incomplete processing resources

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
from sqlalchemy import func, select

from app.agents import ExtractionAgent
from app.core import get_settings
from app.core.app_config import get_app_config
from app.core.datetime_utils import utc_now
from app.db import async_session_factory
from app.models import PageExtraction, PageStatus, Resource
from app.models.resource import ExtractionStatus
from app.services import RedisService, StorageService


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
