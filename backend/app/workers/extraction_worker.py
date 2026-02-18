"""
Extraction worker for ARQ background jobs.

Architecture:
- prepare_extraction: Renders PDF pages to images, creates page records, queues page jobs
- extract_page: Processes a single page (atomic, retryable)
- check_stale_extractions: Cron job to re-queue stuck pages (5 min threshold)
- check_orphan_resources: Cron job to fix resources stuck in PROCESSING
- on_worker_startup: Runs recovery checks immediately on worker start

Recovery behavior:
- On startup: Immediately recovers stuck pages and orphan resources
- Via cron: Every 15 minutes for stale pages and orphan resources

Run with:
    arq app.workers.extraction_worker.WorkerSettings
"""

import io
from datetime import timedelta

import fitz  # PyMuPDF
from arq.cron import cron
from loguru import logger
from PIL import Image
from sqlalchemy import select, func

from app.agents import ExtractionAgent
from app.core import get_settings
from app.core.datetime_utils import utc_now
from app.db import async_session_factory
from app.models import PageExtraction, PageStatus, Resource
from app.models.resource import ExtractionStatus
from app.services import RedisService, StorageService


async def prepare_extraction(ctx: dict, resource_id: int) -> dict:
    """
    Prepare a resource for page-by-page extraction.

    Steps:
    1. Download PDF from R2
    2. Render all pages to PNG and upload to temp folder
    3. Create PageExtraction records for each page
    4. Queue extract_page jobs for incomplete pages
    5. Generate thumbnail from first page

    This is idempotent - calling again will only queue incomplete pages.
    """
    settings = get_settings()
    storage = StorageService(settings)
    redis = RedisService(settings.redis_url)
    await redis.connect()

    logger.info(f"Preparing extraction for resource {resource_id}")

    async with async_session_factory() as session:
        try:
            # Get resource
            resource = await session.get(Resource, resource_id)
            if not resource:
                logger.error(f"Resource {resource_id} not found")
                return {"success": False, "error": "Resource not found"}

            # Update status to processing
            resource.extraction_status = ExtractionStatus.PROCESSING
            await session.flush()

            # Check if pages already rendered
            temp_folder = f"temp/{resource.content_hash}"
            pages_rendered = storage.folder_exists(temp_folder)

            if not pages_rendered:
                # Download and render PDF
                logger.info(f"Rendering pages for resource {resource_id}")
                try:
                    pdf_bytes = storage.download_file(
                        resource.content_hash, folder="raw"
                    )
                except Exception as e:
                    logger.error(f"Failed to download PDF: {e}")
                    resource.extraction_status = ExtractionStatus.FAILED
                    await session.commit()
                    return {"success": False, "error": f"Download failed: {e}"}

                doc = fitz.open(stream=pdf_bytes, filetype="pdf")
                total_pages = len(doc)

                # Update page count
                if not resource.page_count:
                    resource.page_count = total_pages
                    await session.flush()

                # Generate thumbnail from first page
                try:
                    first_page = doc[0]
                    pix = first_page.get_pixmap(dpi=150)
                    img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
                    img.thumbnail((400, 600), Image.Resampling.LANCZOS)

                    thumbnail_buffer = io.BytesIO()
                    img.save(thumbnail_buffer, format="WEBP", quality=85)
                    storage.upload_thumbnail(
                        thumbnail_buffer.getvalue(), resource.content_hash
                    )
                    logger.info(f"Uploaded thumbnail for resource {resource_id}")
                except Exception as e:
                    logger.warning(f"Failed to generate thumbnail: {e}")

                # Render and upload each page
                for page_num in range(total_pages):
                    page = doc[page_num]
                    pix = page.get_pixmap(dpi=200)
                    png_bytes = pix.tobytes("png")

                    # Upload to temp folder
                    storage.upload_file(
                        png_bytes,
                        f"{temp_folder}/page_{page_num + 1}.png",
                        folder=None,
                        content_type="image/png",
                    )

                doc.close()
                logger.info(f"Rendered {total_pages} pages for resource {resource_id}")

            # Check existing page records
            existing_pages = await session.execute(
                select(PageExtraction).where(PageExtraction.resource_id == resource_id)
            )
            existing_pages = {p.page_number: p for p in existing_pages.scalars().all()}

            # Create missing page records
            total_pages = resource.page_count or 0
            for page_num in range(1, total_pages + 1):
                if page_num not in existing_pages:
                    page = PageExtraction(
                        resource_id=resource_id,
                        page_number=page_num,
                        status=PageStatus.PENDING,
                    )
                    session.add(page)

            await session.flush()

            # Get all incomplete pages
            incomplete = await session.execute(
                select(PageExtraction).where(
                    PageExtraction.resource_id == resource_id,
                    PageExtraction.status != PageStatus.COMPLETED,
                )
            )
            incomplete_pages = incomplete.scalars().all()

            # Queue jobs for incomplete pages
            queued = 0
            for page in incomplete_pages:
                # Reset processing status for stuck pages
                if page.status == PageStatus.PROCESSING:
                    page.status = PageStatus.PENDING

                job_id = await redis.enqueue_job(
                    "extract_page",
                    resource_id,
                    page.page_number,
                )
                if job_id:
                    queued += 1

            await session.commit()

            # Set initial progress
            completed_count = total_pages - len(incomplete_pages)
            progress = int(completed_count / total_pages * 100) if total_pages else 0
            await redis.set_progress(
                resource_id,
                status="processing",
                progress=progress,
                current_page=completed_count,
                total_pages=total_pages,
            )

            logger.info(f"Queued {queued} page jobs for resource {resource_id}")
            return {"success": True, "queued": queued, "total_pages": total_pages}

        except Exception as e:
            logger.exception(
                f"Prepare extraction failed for resource {resource_id}: {e}"
            )
            return {"success": False, "error": str(e)}
        finally:
            await redis.close()


async def extract_page(ctx: dict, resource_id: int, page_number: int) -> dict:
    """
    Extract text from a single page.

    This is atomic and retryable. On failure, increments attempt count.
    """
    settings = get_settings()
    storage = StorageService(settings)
    redis = RedisService(settings.redis_url)
    await redis.connect()

    logger.info(f"Extracting page {page_number} for resource {resource_id}")

    async with async_session_factory() as session:
        try:
            # Get page record
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

            # Get resource for content hash
            resource = await session.get(Resource, resource_id)
            if not resource:
                return {"success": False, "error": "Resource not found"}

            # Mark as processing
            page.status = PageStatus.PROCESSING
            page.started_at = utc_now()
            page.attempts += 1
            await session.flush()

            # Download page image from temp folder
            temp_path = f"temp/{resource.content_hash}/page_{page_number}.png"
            try:
                png_bytes = storage.download_file(temp_path, folder=None)
            except Exception as e:
                page.last_error = f"Failed to download page image: {e}"
                page.status = PageStatus.PENDING  # Allow retry
                await session.commit()
                return {"success": False, "error": str(e)}

            # Initialize extraction agent
            agent = ExtractionAgent(
                api_key=settings.openrouter_api_key,
                model_id=settings.extraction_agent_model,
            )

            # Extract text
            result = agent.extract_page(png_bytes, page_number)

            if result.success:
                # Upload extracted markdown
                storage.upload_processed_page(
                    result.markdown,
                    resource.content_hash,
                    page_number,
                )

                # Delete temp PNG to save storage
                try:
                    storage.delete_file(temp_path, folder=None)
                except Exception as e:
                    logger.warning(f"Failed to delete temp file {temp_path}: {e}")

                # Mark as completed
                page.status = PageStatus.COMPLETED
                page.completed_at = utc_now()
                page.last_error = None

                logger.info(
                    f"Extracted page {page_number} for resource {resource_id}: {len(result.markdown)} chars"
                )
            else:
                # Keep as pending for retry
                page.status = PageStatus.PENDING
                page.last_error = result.error
                logger.warning(f"Page {page_number} extraction failed: {result.error}")

            await session.flush()

            # Update progress
            await _update_resource_progress(session, redis, resource_id)

            await session.commit()

            return {"success": result.success, "page": page_number}

        except Exception as e:
            logger.exception(
                f"Error extracting page {page_number} for resource {resource_id}: {e}"
            )

            # Update page status
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
        finally:
            await redis.close()


async def _update_resource_progress(session, redis: RedisService, resource_id: int):
    """Update resource progress based on completed pages."""
    # Count pages
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

    # Update Redis progress
    await redis.set_progress(
        resource_id,
        status="processing" if completed < total else "completed",
        progress=progress,
        current_page=completed,
        total_pages=total,
    )

    # Update resource status if all done
    if completed == total and total > 0:
        resource = await session.get(Resource, resource_id)
        if resource:
            resource.extraction_status = ExtractionStatus.COMPLETED
            resource.processed_at = utc_now()
            logger.info(f"Extraction completed for resource {resource_id}")


async def check_stale_extractions(ctx: dict):
    """
    Cron job: Find stuck extractions and re-queue them.

    A page is considered stuck if:
    - Status is PROCESSING
    - Started more than 5 minutes ago (stale threshold)

    This catches pages that got stuck due to API timeouts, network issues,
    or other transient failures during extraction.
    """
    settings = get_settings()
    redis = RedisService(settings.redis_url)
    await redis.connect()

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
        finally:
            await redis.close()


def _get_worker_redis_settings():
    """Get Redis settings for worker initialization."""
    settings = get_settings()
    redis = RedisService(settings.redis_url)
    return redis.redis_settings


async def on_worker_startup(ctx: dict):
    """
    Run recovery checks immediately when worker starts.

    This ensures crashed extractions are recovered without waiting
    for the cron schedule.
    """
    logger.info("Worker startup: running recovery checks...")
    
    # Check for stuck pages
    stale_result = await check_stale_extractions(ctx)
    logger.info(f"Stale extractions check: {stale_result}")
    
    # Check for orphan resources
    orphan_result = await check_orphan_resources(ctx)
    logger.info(f"Orphan resources check: {orphan_result}")
    
    logger.info("Worker startup recovery complete")


class WorkerSettings:
    """ARQ worker settings."""

    functions = [prepare_extraction, extract_page]
    on_startup = on_worker_startup
    cron_jobs = [
        cron(check_stale_extractions, minute={0, 15, 30, 45}),  # Every 15 minutes
    ]
    redis_settings = _get_worker_redis_settings()
    queue_name = "glot:extraction_queue"
    max_jobs = 4  # Process 4 page jobs concurrently
    job_timeout = 600  # 10 minute timeout per page
    keep_result = 0  # Don't keep results in Redis (saves space/commands)
    health_check_interval = 600  # Check health every 10 minutes (saves commands)
    poll_delay = 5  # Poll for new jobs every 5s instead of 0.5s (saves ~90% of commands)
