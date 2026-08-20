"""
Resources API endpoints.

Endpoints:
    POST   /resources/upload         - Request presigned URL for upload
    POST   /resources/upload/confirm - Confirm upload completion
    GET    /resources                - List user's resources (My Library)
    GET    /resources/public         - List public resources
    GET    /resources/{id}           - Get resource details
    POST   /resources/{id}/add       - Add public resource to library
    PATCH  /resources/{id}           - Update resource (name, visibility)
    DELETE /resources/{id}           - Remove resource from library
    POST   /resources/{id}/extract   - Trigger extraction
    GET    /resources/{id}/progress  - Get extraction progress
"""

import hashlib
import io
import logging
from datetime import UTC, datetime, timedelta
from typing import Annotated, NoReturn

import fitz  # PyMuPDF
from fastapi import APIRouter, Depends, HTTPException, Query, status
from PIL import Image
from sqlalchemy import delete, func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col, select

from app.core import get_settings
from app.core.app_config import get_app_config
from app.dependencies import get_async_session, get_current_user, get_storage_service
from app.models import Resource, User, UserResource
from app.models.resource import ExtractionStatus
from app.schemas.resource import (
    AddPublicResourceRequest,
    ExtractionProgressResponse,
    ResourceListResponse,
    ResourceRead,
    ResourceUpdateRequest,
    UploadRequest,
    UploadResponse,
)
from app.services import RedisService, StorageService
from app.services.storage_service import StorageObjectTooLargeError

router = APIRouter()

# Statuses that can have an in-flight extraction worth probing Redis for.
_ACTIVE_EXTRACTION_STATUSES = (
    ExtractionStatus.PENDING,
    ExtractionStatus.PROCESSING,
)


# A progress signal older than the worker timeout is no longer evidence of
# active work. Keep a small buffer over WorkerSettings.job_timeout (20 min).
_ACTIVE_PROGRESS_MAX_AGE = timedelta(minutes=25)
UPLOAD_URL_EXPIRES_SECONDS = 900


def _has_recent_progress_signal(progress: dict | None) -> bool:
    """Return True when Redis progress is recent enough to count as active."""
    if not progress:
        return False

    updated_at = progress.get("updated_at")
    if not updated_at:
        return False

    try:
        updated = datetime.fromisoformat(str(updated_at))
    except ValueError:
        return False

    if updated.tzinfo is None:
        updated = updated.replace(tzinfo=UTC)

    return datetime.now(UTC) - updated <= _ACTIVE_PROGRESS_MAX_AGE


def _recovery_flags(
    status: ExtractionStatus,
    progress: dict | None,
) -> tuple[bool, bool]:
    """Compute (extraction_problem, can_resume_extraction) for one resource.

    DB status is the source of truth; ``progress`` is only a Redis liveness
    signal. Missing or stale progress means there is no active signal:
    - FAILED: a problem the user can retry.
    - PENDING/PROCESSING without a recent progress signal: interrupted/stale
      and resumable (the worker likely restarted; there is no cron to recover it).
    - PENDING/PROCESSING with a recent progress signal: actively running, no problem.
    - NONE/COMPLETED: nothing to recover.
    """
    if status == ExtractionStatus.FAILED:
        return True, True
    if status in _ACTIVE_EXTRACTION_STATUSES:
        if not _has_recent_progress_signal(progress):
            return True, True
        return False, False
    return False, False


async def _attach_recovery_state(items: list[tuple[ResourceRead, Resource]]) -> None:
    """Populate recovery flags for resources already in this request scope.

    Only the resources being returned are evaluated (no global DB/queue scan).
    Redis is consulted purely as a progress/liveness signal, never as truth.
    """
    needs_redis = any(
        res.extraction_status in _ACTIVE_EXTRACTION_STATUSES for _, res in items
    )

    redis: RedisService | None = None
    try:
        if needs_redis:
            redis = RedisService(get_settings().redis_url)
            await redis.connect()

        for read, res in items:
            progress: dict | None = None
            if redis is not None and res.extraction_status in _ACTIVE_EXTRACTION_STATUSES:
                try:
                    progress = await redis.get_progress(res.id)
                except Exception:
                    progress = None
            read.extraction_problem, read.can_resume_extraction = _recovery_flags(
                res.extraction_status,
                progress,
            )
    finally:
        if redis is not None:
            await redis.close()


def _build_resource_read(
    resource: Resource,
    user_resource: UserResource,
    current_user_id: int,
) -> ResourceRead:
    """Build ResourceRead from Resource and UserResource."""
    return ResourceRead(
        id=resource.id,
        content_hash=resource.content_hash,
        name=user_resource.name,
        size_bytes=resource.size_bytes,
        page_count=resource.page_count,
        is_public=resource.is_public,
        extraction_status=resource.extraction_status,
        uploaded_at=resource.uploaded_at,
        processed_at=resource.processed_at,
        is_owner=resource.uploaded_by == current_user_id,
    )


def _is_publicly_available(resource: Resource) -> bool:
    """Public access starts only after server-side upload validation."""
    return resource.is_public and resource.upload_confirmed


def _upload_reservation_expired(resource: Resource) -> bool:
    uploaded_at = resource.uploaded_at
    if uploaded_at.tzinfo is None:
        uploaded_at = uploaded_at.replace(tzinfo=UTC)
    return datetime.now(UTC) - uploaded_at >= timedelta(
        seconds=UPLOAD_URL_EXPIRES_SECONDS
    )


async def _enforce_resource_capacity(
    session: AsyncSession,
    user_id: int | None,
    maximum: int,
) -> None:
    if user_id is None:
        raise RuntimeError("Authenticated user must have a persisted ID")
    count_query = (
        select(func.count())
        .select_from(UserResource)
        .where(UserResource.user_id == user_id)
    )
    result = await session.execute(count_query)
    if (result.scalar() or 0) >= maximum:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"File limit reached. Maximum is {maximum} files",
        )


@router.post("/upload", response_model=UploadResponse)
async def request_upload(
    request: UploadRequest,
    session: Annotated[AsyncSession, Depends(get_async_session)],
    current_user: Annotated[User, Depends(get_current_user)],
    storage: Annotated[StorageService, Depends(get_storage_service)],
):
    """
    Request a presigned URL for uploading a PDF.

    Client must compute content_hash (SHA-256) before calling this endpoint.
    This enables content deduplication and content-addressable storage.
    """
    resources_config = get_app_config().resources

    # Reject disallowed MIME types / non-PDF file names before any DB work.
    if (
        request.content_type not in resources_config.allowed_types
        or not request.file_name.lower().endswith(".pdf")
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only PDF files are supported",
        )

    # Check file size limit
    if request.size_bytes > resources_config.max_size_bytes:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"File too large. Maximum size is {resources_config.max_size_bytes // (1024 * 1024)} MB",
        )

    # Check if content already exists (deduplication)
    existing = await session.execute(
        select(Resource)
        .where(Resource.content_hash == request.content_hash)
        .with_for_update()
    )
    existing_resource = existing.scalar_one_or_none()

    if existing_resource:
        user_has_it = await session.execute(
            select(UserResource).where(
                UserResource.user_id == current_user.id,
                UserResource.resource_id == existing_resource.id,
            )
        )
        user_resource = user_has_it.scalar_one_or_none()

        if not existing_resource.upload_confirmed:
            reservation_taken_over = False
            if existing_resource.uploaded_by != current_user.id:
                if not _upload_reservation_expired(existing_resource):
                    raise HTTPException(
                        status_code=status.HTTP_409_CONFLICT,
                        detail="This upload is still being validated",
                    )

                await _enforce_resource_capacity(
                    session,
                    current_user.id,
                    resources_config.max_files_per_user,
                )
                await session.execute(
                    delete(UserResource).where(
                        UserResource.resource_id == existing_resource.id
                    )
                )
                try:
                    await storage.async_delete_file(
                        existing_resource.content_hash,
                        folder="raw",
                    )
                except Exception as exc:
                    logging.warning(
                        "Failed to delete expired upload reservation %s: %s",
                        existing_resource.content_hash,
                        exc,
                    )

                existing_resource.uploaded_by = current_user.id
                existing_resource.size_bytes = request.size_bytes
                existing_resource.file_name = request.file_name
                existing_resource.is_public = request.is_public
                existing_resource.uploaded_at = datetime.now(UTC)
                existing_resource.page_count = None
                existing_resource.upload_confirmed = False
                existing_resource.extraction_status = ExtractionStatus.NONE
                existing_resource.processed_at = None
                user_resource = None
                reservation_taken_over = True

            if existing_resource.size_bytes != request.size_bytes:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Pending upload metadata does not match this file",
                )
            if user_resource is None:
                if not reservation_taken_over:
                    await _enforce_resource_capacity(
                        session,
                        current_user.id,
                        resources_config.max_files_per_user,
                    )
                user_resource = UserResource(
                    user_id=current_user.id,
                    resource_id=existing_resource.id,
                    name=request.name,
                )
                session.add(user_resource)

            existing_resource.uploaded_at = datetime.now(UTC)
            await session.flush()

            upload_url = storage.generate_upload_url(
                request.content_hash,
                content_type=request.content_type,
            )
            return UploadResponse(
                upload_url=upload_url,
                resource_id=existing_resource.id,
                expires_in=UPLOAD_URL_EXPIRES_SECONDS,
            )

        if user_resource is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="You already have this file in your library",
            )

        # Confirmed content can be linked without another upload.
        await _enforce_resource_capacity(
            session,
            current_user.id,
            resources_config.max_files_per_user,
        )
        user_resource = UserResource(
            user_id=current_user.id,
            resource_id=existing_resource.id,
            name=request.name,
        )
        session.add(user_resource)
        await session.flush()

        return UploadResponse(
            upload_url="",
            resource_id=existing_resource.id,
            expires_in=0,
        )

    await _enforce_resource_capacity(
        session,
        current_user.id,
        resources_config.max_files_per_user,
    )

    # New content - create resource record
    # NOTE: page_count is computed server-side after upload confirmation.
    resource = Resource(
        content_hash=request.content_hash,
        size_bytes=request.size_bytes,
        page_count=None,
        upload_confirmed=False,
        file_name=request.file_name,  # Store original filename
        is_public=request.is_public,
        extraction_status=ExtractionStatus.NONE,
        uploaded_by=current_user.id,
    )
    try:
        async with session.begin_nested():
            session.add(resource)
            await session.flush()
    except IntegrityError:
        # A concurrent request inserted the same content hash. The unique
        # constraint is authoritative; reload its row through the normal
        # existing-resource path instead of leaking a 500.
        return await request_upload(request, session, current_user, storage)

    # Create user_resource link with custom name
    user_resource = UserResource(
        user_id=current_user.id,
        resource_id=resource.id,
        name=request.name,  # Store user's custom name
    )
    session.add(user_resource)
    await session.flush()

    # Generate presigned URL using real content hash and validated content type
    upload_url = storage.generate_upload_url(
        request.content_hash,
        content_type=request.content_type,
    )

    return UploadResponse(
        upload_url=upload_url,
        resource_id=resource.id,
        expires_in=UPLOAD_URL_EXPIRES_SECONDS,
    )


async def _reject_upload(
    session: AsyncSession,
    storage: StorageService,
    resource: Resource,
    user_resource: UserResource,
    detail: str,
) -> NoReturn:
    """Delete the pending raw object and DB rows for a failed upload confirmation."""
    try:
        await storage.async_delete_file(resource.content_hash, folder="raw")
    except Exception as exc:
        logging.warning(
            "Failed to delete rejected raw upload %s: %s",
            resource.content_hash,
            exc,
        )
    await session.delete(user_resource)
    await session.delete(resource)
    await session.commit()
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=detail)


@router.post("/upload/confirm", response_model=ResourceRead)
async def confirm_upload(
    resource_id: int = Query(..., description="Resource ID from upload request"),
    session: Annotated[AsyncSession, Depends(get_async_session)] = None,
    current_user: Annotated[User, Depends(get_current_user)] = None,
    storage: Annotated[StorageService, Depends(get_storage_service)] = None,
):
    """
    Confirm upload completion, verify content integrity, and generate a thumbnail.

    Called after file is uploaded to R2. The client-declared metadata (size,
    hash) is untrusted until we download the object ourselves and check it -
    otherwise a caller could presign, upload arbitrary content, and confirm
    a resource that doesn't match what deduplication/downloads assume it is.
    """
    # Lock the reservation through download and validation so expiry takeover
    # cannot transfer ownership underneath an in-flight confirmation.
    resource = await session.get(
        Resource,
        resource_id,
        with_for_update=True,
    )
    if not resource:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Resource not found",
        )

    if resource.uploaded_by != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized",
        )

    # Verify user has this resource
    ur_result = await session.execute(
        select(UserResource).where(
            UserResource.user_id == current_user.id,
            UserResource.resource_id == resource.id,
        )
    )
    user_resource = ur_result.scalar_one_or_none()
    if not user_resource:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Resource not in your library",
        )

    # Always re-download and verify: the uploaded object is untrusted until
    # its actual bytes are checked against the metadata that was requested.
    max_bytes = min(resource.size_bytes, get_app_config().resources.max_size_bytes)
    try:
        pdf_bytes = await storage.async_download_file_bounded(
            resource.content_hash,
            folder="raw",
            max_bytes=max_bytes,
        )
    except StorageObjectTooLargeError:
        await _reject_upload(
            session,
            storage,
            resource,
            user_resource,
            "Uploaded file exceeds the declared size",
        )

    actual_size = len(pdf_bytes)
    actual_hash = hashlib.sha256(pdf_bytes).hexdigest()
    if actual_size != resource.size_bytes or actual_hash != resource.content_hash:
        await _reject_upload(
            session,
            storage,
            resource,
            user_resource,
            "Uploaded file does not match the requested metadata",
        )

    try:
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    except Exception:
        await _reject_upload(
            session,
            storage,
            resource,
            user_resource,
            "Uploaded file is not a valid PDF",
        )

    if len(doc) < 1:
        doc.close()
        await _reject_upload(
            session,
            storage,
            resource,
            user_resource,
            "Uploaded file is not a valid PDF",
        )

    try:
        resource.page_count = len(doc)
        resource.upload_confirmed = True
        await session.flush()

        # Thumbnail generation is best-effort and only attempted once the
        # document itself has been proven to be a valid, matching PDF.
        try:
            if not await storage.async_file_exists(
                resource.content_hash,
                folder="thumbnails",
            ):
                first_page = doc[0]
                pix = first_page.get_pixmap(dpi=150)
                img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
                img.thumbnail((400, 600), Image.Resampling.LANCZOS)

                thumbnail_buffer = io.BytesIO()
                img.save(thumbnail_buffer, format="WEBP", quality=85)
                await storage.async_upload_thumbnail(
                    thumbnail_buffer.getvalue(),
                    resource.content_hash,
                )
        except Exception as e:
            logging.warning(f"Failed to generate thumbnail for {resource_id}: {e}")
    finally:
        doc.close()
    await session.refresh(resource)
    return _build_resource_read(resource, user_resource, current_user.id)


@router.get("", response_model=ResourceListResponse)
async def list_my_resources(
    session: Annotated[AsyncSession, Depends(get_async_session)],
    current_user: Annotated[User, Depends(get_current_user)],
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
):
    """List resources in user's library (My Library)."""
    # Count total
    count_query = (
        select(func.count())
        .select_from(UserResource)
        .where(UserResource.user_id == current_user.id)
    )
    total_result = await session.execute(count_query)
    total = total_result.scalar() or 0

    # Get resources with user names
    query = (
        select(Resource, UserResource)
        .join(UserResource, Resource.id == UserResource.resource_id)
        .where(UserResource.user_id == current_user.id)
        .order_by(UserResource.added_at.desc())
        .offset(offset)
        .limit(limit)
    )
    result = await session.execute(query)
    rows = result.all()

    reads_with_resources = [
        (_build_resource_read(resource, user_resource, current_user.id), resource)
        for resource, user_resource in rows
    ]
    await _attach_recovery_state(reads_with_resources)
    items = [read for read, _ in reads_with_resources]

    return ResourceListResponse(items=items, total=total, limit=limit, offset=offset)


@router.get("/public", response_model=ResourceListResponse)
async def list_public_resources(
    session: Annotated[AsyncSession, Depends(get_async_session)],
    current_user: Annotated[User, Depends(get_current_user)],
    search: str | None = Query(None, description="Search in resource names"),
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
):
    """List public resources (Public Library)."""
    # Base query for confirmed public resources
    base_query = select(Resource).where(
        Resource.is_public == True,  # noqa: E712
        col(Resource.upload_confirmed).is_(True),
    )

    if search:
        base_query = base_query.where(Resource.file_name.ilike(f"%{search}%"))

    # Count total
    count_query = select(func.count()).select_from(base_query.subquery())
    total_result = await session.execute(count_query)
    total = total_result.scalar() or 0

    # Get resources
    query = base_query.order_by(Resource.uploaded_at.desc()).offset(offset).limit(limit)
    result = await session.execute(query)
    resources = result.scalars().all()

    # Check which ones are in user's library
    user_resources_query = select(UserResource).where(
        UserResource.user_id == current_user.id,
        UserResource.resource_id.in_([r.id for r in resources]),
    )
    ur_result = await session.execute(user_resources_query)
    user_resources = {ur.resource_id: ur for ur in ur_result.scalars().all()}

    # Get uploader's custom names
    uploader_names_query = select(UserResource).where(
        UserResource.resource_id.in_([r.id for r in resources]),
        UserResource.user_id.in_([r.uploaded_by for r in resources]),
    )
    uploader_result = await session.execute(uploader_names_query)
    uploader_names = {ur.resource_id: ur.name for ur in uploader_result.scalars().all()}

    items = []
    for resource in resources:
        ur = user_resources.get(resource.id)
        # Priority: 1) Current user's custom name, 2) Uploader's custom name, 3) File name
        name = ur.name if ur else uploader_names.get(resource.id, resource.file_name)
        items.append(
            ResourceRead(
                id=resource.id,
                content_hash=resource.content_hash,
                name=name,
                size_bytes=resource.size_bytes,
                page_count=resource.page_count,
                is_public=resource.is_public,
                extraction_status=resource.extraction_status,
                uploaded_at=resource.uploaded_at,
                processed_at=resource.processed_at,
                is_owner=resource.uploaded_by == current_user.id,
            )
        )

    return ResourceListResponse(items=items, total=total, limit=limit, offset=offset)


@router.get("/{resource_id}", response_model=ResourceRead)
async def get_resource(
    resource_id: int,
    session: Annotated[AsyncSession, Depends(get_async_session)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    """Get a single resource's details."""
    resource = await session.get(Resource, resource_id)
    if not resource:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Resource not found",
        )

    # Check access - must be owner, in library, or public
    ur_result = await session.execute(
        select(UserResource).where(
            UserResource.user_id == current_user.id,
            UserResource.resource_id == resource_id,
        )
    )
    user_resource = ur_result.scalar_one_or_none()

    if not user_resource and not _is_publicly_available(resource):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized",
        )

    name = user_resource.name if user_resource else resource.file_name
    read = ResourceRead(
        id=resource.id,
        content_hash=resource.content_hash,
        name=name,
        size_bytes=resource.size_bytes,
        page_count=resource.page_count,
        is_public=resource.is_public,
        extraction_status=resource.extraction_status,
        uploaded_at=resource.uploaded_at,
        processed_at=resource.processed_at,
        is_owner=resource.uploaded_by == current_user.id,
    )

    # Only library resources can be resumed by this user; skip recovery probe otherwise.
    if user_resource is not None:
        await _attach_recovery_state([(read, resource)])

    return read


@router.post("/{resource_id}/add", response_model=ResourceRead, status_code=201)
async def add_public_resource(
    resource_id: int,
    request: AddPublicResourceRequest,
    session: Annotated[AsyncSession, Depends(get_async_session)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    """Add a public resource to user's library."""
    resources_config = get_app_config().resources

    resource = await session.get(Resource, resource_id)
    if not resource or not _is_publicly_available(resource):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Public resource not found",
        )

    # Check if already in library
    existing = await session.execute(
        select(UserResource).where(
            UserResource.user_id == current_user.id,
            UserResource.resource_id == resource_id,
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Resource already in library",
        )

    # Check user's file count limit
    count_query = (
        select(func.count())
        .select_from(UserResource)
        .where(UserResource.user_id == current_user.id)
    )
    result = await session.execute(count_query)
    current_count = result.scalar() or 0

    if current_count >= resources_config.max_files_per_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"File limit reached. Maximum is {resources_config.max_files_per_user} files",
        )

    # Add to library
    user_resource = UserResource(
        user_id=current_user.id,
        resource_id=resource_id,
        name=request.name,
    )
    session.add(user_resource)
    await session.flush()

    return _build_resource_read(resource, user_resource, current_user.id)


@router.patch("/{resource_id}", response_model=ResourceRead)
async def update_resource(
    resource_id: int,
    request: ResourceUpdateRequest,
    session: Annotated[AsyncSession, Depends(get_async_session)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    """Update resource name or visibility."""
    resource = await session.get(Resource, resource_id)
    if not resource:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Resource not found",
        )

    # Get user's link to this resource
    ur_result = await session.execute(
        select(UserResource).where(
            UserResource.user_id == current_user.id,
            UserResource.resource_id == resource_id,
        )
    )
    user_resource = ur_result.scalar_one_or_none()

    if not user_resource:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Resource not in your library",
        )

    # Update name (user-specific)
    if request.name is not None:
        user_resource.name = request.name

    # Update visibility (only owner can change)
    if request.is_public is not None:
        if resource.uploaded_by != current_user.id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only the owner can change visibility",
            )
        resource.is_public = request.is_public

    await session.flush()
    await session.commit()
    await session.refresh(resource)
    await session.refresh(user_resource)

    return _build_resource_read(resource, user_resource, current_user.id)


@router.delete("/{resource_id}", status_code=204)
async def delete_resource(
    resource_id: int,
    session: Annotated[AsyncSession, Depends(get_async_session)],
    current_user: Annotated[User, Depends(get_current_user)],
    storage: Annotated[StorageService, Depends(get_storage_service)],
):
    """
    Remove resource from user's library.

    If user is the owner and no other users have it, delete from R2 as well.
    """
    resource = await session.get(Resource, resource_id)
    if not resource:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Resource not found",
        )

    # Get user's link
    ur_result = await session.execute(
        select(UserResource).where(
            UserResource.user_id == current_user.id,
            UserResource.resource_id == resource_id,
        )
    )
    user_resource = ur_result.scalar_one_or_none()

    if not user_resource:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Resource not in your library",
        )

    # Remove from user's library
    await session.delete(user_resource)
    await session.flush()

    # Check if owner and no other users have it
    if resource.uploaded_by == current_user.id:
        other_users = await session.execute(
            select(func.count())
            .select_from(UserResource)
            .where(UserResource.resource_id == resource_id)
        )
        other_count = other_users.scalar() or 0

        if other_count == 0:
            # Delete from R2
            content_hash = resource.content_hash
            if not content_hash.startswith("pending_"):
                await storage.async_delete_file(content_hash, folder="raw")
                await storage.async_delete_file(content_hash, folder="thumbnails")
                await storage.async_delete_processed_folder(content_hash)

            # Delete from database
            await session.delete(resource)


@router.get("/{resource_id}/download")
async def get_download_url(
    resource_id: int,
    session: Annotated[AsyncSession, Depends(get_async_session)],
    current_user: Annotated[User, Depends(get_current_user)],
    storage: Annotated[StorageService, Depends(get_storage_service)],
):
    """
    Get a presigned URL for downloading/viewing the PDF.

    Returns a URL valid for 1 hour.
    """
    resource = await session.get(Resource, resource_id)
    if not resource:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Resource not found",
        )

    # Must be in user's library or public
    ur_result = await session.execute(
        select(UserResource).where(
            UserResource.user_id == current_user.id,
            UserResource.resource_id == resource_id,
        )
    )
    user_resource = ur_result.scalar_one_or_none()

    if not user_resource and not _is_publicly_available(resource):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Resource not accessible",
        )

    # Generate presigned download URL
    # Security decision: use deterministic hash-based filename for downloads.
    download_filename = f"{resource.content_hash}.pdf"
    url = storage.generate_download_url(
        resource.content_hash,
        folder="raw",
        expires_in=3600,
    )

    return {"url": url, "filename": download_filename}


@router.get("/{resource_id}/thumbnail")
async def get_thumbnail_url(
    resource_id: int,
    session: Annotated[AsyncSession, Depends(get_async_session)],
    current_user: Annotated[User, Depends(get_current_user)],
    storage: Annotated[StorageService, Depends(get_storage_service)],
):
    """Get a presigned URL for the resource thumbnail."""
    resource = await session.get(Resource, resource_id)
    if not resource:
        raise HTTPException(status_code=404, detail="Resource not found")

    # Check access (same logic as download)
    ur_result = await session.execute(
        select(UserResource).where(
            UserResource.user_id == current_user.id,
            UserResource.resource_id == resource_id,
        )
    )
    if (
        not ur_result.scalar_one_or_none()
        and not _is_publicly_available(resource)
    ):
        raise HTTPException(status_code=403, detail="Resource not accessible")

    # Generate URL
    if not await storage.async_file_exists(resource.content_hash, folder="thumbnails"):
        # Return default placeholder or 404?
        # For now, 404 so frontend can show default icon
        raise HTTPException(status_code=404, detail="Thumbnail not found")

    url = storage.generate_download_url(
        resource.content_hash,
        folder="thumbnails",
        expires_in=3600,
        response_content_type="image/webp",
    )

    return {"url": url}


@router.get("/{resource_id}/progress", response_model=ExtractionProgressResponse)
async def get_extraction_progress(
    resource_id: int,
    session: Annotated[AsyncSession, Depends(get_async_session)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    """Get extraction progress for a resource."""
    resource = await session.get(Resource, resource_id)
    if not resource:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Resource not found",
        )

    # Verify user has access
    ur_result = await session.execute(
        select(UserResource).where(
            UserResource.user_id == current_user.id,
            UserResource.resource_id == resource_id,
        )
    )
    if not ur_result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Resource not in your library",
        )

    # Try to get progress from Redis for active extractions
    if resource.extraction_status in [
        ExtractionStatus.PENDING,
        ExtractionStatus.PROCESSING,
    ]:
        try:
            redis = RedisService(get_settings().redis_url)
            await redis.connect()
            progress_data = await redis.get_progress(resource_id)
            await redis.close()

            if progress_data:
                return ExtractionProgressResponse(
                    status=resource.extraction_status,
                    progress=progress_data.get("progress", 0),
                    current_page=progress_data.get("current_page"),
                    total_pages=resource.page_count,
                )
        except Exception:
            pass  # Fall through to default response

    return ExtractionProgressResponse(
        status=resource.extraction_status,
        progress=100 if resource.extraction_status == ExtractionStatus.COMPLETED else 0,
        current_page=(
            resource.page_count
            if resource.extraction_status == ExtractionStatus.COMPLETED
            else None
        ),
        total_pages=resource.page_count,
    )


@router.post("/{resource_id}/extract", status_code=202)
async def trigger_extraction(
    resource_id: int,
    session: Annotated[AsyncSession, Depends(get_async_session)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    """
    Trigger or resume text extraction for a resource.

    This is idempotent - calling multiple times will:
    - For new extraction: render pages and queue all page jobs
    - For incomplete/interrupted (Resume): queue only incomplete pages
    - For completed: return error (already done)

    This same endpoint backs the frontend "Resume" action for interrupted or
    failed extractions: it re-queues only incomplete work via the idempotent
    prepare_extraction job. A deterministic ARQ job id dedupes concurrent
    triggers so a double click cannot double-queue.

    Returns 202 Accepted - extraction runs in background.
    """
    resource = await session.get(Resource, resource_id)
    if not resource:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Resource not found",
        )

    # Verify user has this in their library
    ur_result = await session.execute(
        select(UserResource).where(
            UserResource.user_id == current_user.id,
            UserResource.resource_id == resource_id,
        )
    )
    if not ur_result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Resource not in your library",
        )

    if not resource.upload_confirmed:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Upload must be confirmed before extraction",
        )

    # Only block if already completed
    if resource.extraction_status == ExtractionStatus.COMPLETED:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Extraction already completed",
        )

    # Update status to pending (prepare_extraction will set to processing)
    if resource.extraction_status not in [
        ExtractionStatus.PENDING,
        ExtractionStatus.PROCESSING,
    ]:
        resource.extraction_status = ExtractionStatus.PENDING
        await session.flush()

    await session.commit()

    # Enqueue prepare_extraction job (handles rendering + page job queueing).
    # Deterministic job id dedupes concurrent Extract/Resume triggers.
    settings = get_settings()
    redis = RedisService(settings.redis_url)
    job_id = await redis.enqueue_job(
        "prepare_extraction",
        resource_id,
        _job_id=f"glot:prepare:{resource_id}",
    )
    # Mark this resource as intentionally queued so a quick refresh does not
    # look interrupted before the worker has written its first progress update.
    await redis.set_progress(
        resource_id,
        status="pending",
        progress=0,
        current_page=None,
        total_pages=resource.page_count,
    )
    await redis.close()

    return {
        "message": "Extraction queued",
        "resource_id": resource_id,
        "job_id": job_id,
    }
