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

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.core import get_settings
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
from app.services import StorageService

router = APIRouter()


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
    settings = get_settings()

    # Check file size limit
    if request.size_bytes > settings.resource_max_size_bytes:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"File too large. Maximum size is {settings.resource_max_size_bytes // (1024 * 1024)} MB",
        )

    # Check user's file count limit
    count_query = (
        select(func.count())
        .select_from(UserResource)
        .where(UserResource.user_id == current_user.id)
    )
    result = await session.execute(count_query)
    current_count = result.scalar() or 0

    if current_count >= settings.resource_max_files_per_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"File limit reached. Maximum is {settings.resource_max_files_per_user} files",
        )

    # Check if content already exists (deduplication)
    existing = await session.execute(
        select(Resource).where(Resource.content_hash == request.content_hash)
    )
    existing_resource = existing.scalar_one_or_none()

    if existing_resource:
        # Content exists - check if user already has it
        user_has_it = await session.execute(
            select(UserResource).where(
                UserResource.user_id == current_user.id,
                UserResource.resource_id == existing_resource.id,
            )
        )
        if user_has_it.scalar_one_or_none():
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="You already have this file in your library",
            )

        # Link user to existing resource (no upload needed)
        user_resource = UserResource(
            user_id=current_user.id,
            resource_id=existing_resource.id,
            name=request.name,
        )
        session.add(user_resource)
        await session.flush()

        # Return empty upload_url to signal no upload needed
        return UploadResponse(
            upload_url="",  # Empty = already exists
            resource_id=existing_resource.id,
            expires_in=0,
        )

    # New content - create resource record
    # NOTE: page_count is computed server-side after upload confirmation.
    resource = Resource(
        content_hash=request.content_hash,
        size_bytes=request.size_bytes,
        page_count=None,
        file_name=request.file_name,  # Store original filename
        is_public=request.is_public,
        extraction_status=ExtractionStatus.NONE,
        uploaded_by=current_user.id,
    )
    session.add(resource)
    await session.flush()

    # Create user_resource link with custom name
    user_resource = UserResource(
        user_id=current_user.id,
        resource_id=resource.id,
        name=request.name,  # Store user's custom name
    )
    session.add(user_resource)
    await session.flush()

    # Generate presigned URL using real content hash
    upload_url = storage.generate_upload_url(request.content_hash)

    return UploadResponse(
        upload_url=upload_url,
        resource_id=resource.id,
        expires_in=900,
    )


@router.post("/upload/confirm", response_model=ResourceRead)
async def confirm_upload(
    resource_id: int = Query(..., description="Resource ID from upload request"),
    session: Annotated[AsyncSession, Depends(get_async_session)] = None,
    current_user: Annotated[User, Depends(get_current_user)] = None,
    storage: Annotated[StorageService, Depends(get_storage_service)] = None,
):
    """
    Confirm upload completion and generate thumbnail.

    Called after file is uploaded to R2. Generates a thumbnail for display.
    """
    # Get the resource
    resource = await session.get(Resource, resource_id)
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

    # Ensure authoritative page_count and thumbnail from the uploaded PDF.
    needs_page_count = not resource.page_count
    needs_thumbnail = not storage.file_exists(resource.content_hash, folder="thumbnails")

    if needs_page_count or needs_thumbnail:
        try:
            import io

            import fitz  # PyMuPDF
            from PIL import Image

            # Download PDF from R2
            pdf_bytes = storage.download_file(resource.content_hash, folder="raw")

            # Open PDF with PyMuPDF
            doc = fitz.open(stream=pdf_bytes, filetype="pdf")

            if needs_page_count:
                resource.page_count = len(doc)
                await session.flush()

            if needs_thumbnail and len(doc) > 0:
                first_page = doc[0]
                pix = first_page.get_pixmap(dpi=150)
                img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
                img.thumbnail((400, 600), Image.Resampling.LANCZOS)

                thumbnail_buffer = io.BytesIO()
                img.save(thumbnail_buffer, format="WEBP", quality=85)
                storage.upload_thumbnail(thumbnail_buffer.getvalue(), resource.content_hash)

            doc.close()
        except Exception as e:
            # Log but don't fail - thumbnail is optional, page_count can be recovered during extraction prep.
            import logging

            logging.warning(f"Failed to finalize upload metadata for {resource_id}: {e}")

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

    items = [
        _build_resource_read(resource, user_resource, current_user.id)
        for resource, user_resource in rows
    ]

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
    # Base query for public resources
    base_query = select(Resource).where(Resource.is_public == True)  # noqa: E712

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

    if not user_resource and not resource.is_public:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized",
        )

    name = user_resource.name if user_resource else resource.file_name
    return ResourceRead(
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


@router.post("/{resource_id}/add", response_model=ResourceRead, status_code=201)
async def add_public_resource(
    resource_id: int,
    request: AddPublicResourceRequest,
    session: Annotated[AsyncSession, Depends(get_async_session)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    """Add a public resource to user's library."""
    settings = get_settings()

    resource = await session.get(Resource, resource_id)
    if not resource or not resource.is_public:
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

    if current_count >= settings.resource_max_files_per_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"File limit reached. Maximum is {settings.resource_max_files_per_user} files",
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
                storage.delete_file(content_hash, folder="raw")
                storage.delete_file(content_hash, folder="thumbnails")
                storage.delete_processed_folder(content_hash)

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

    if not user_resource and not resource.is_public:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Resource not accessible",
        )

    # Generate presigned download URL
    name = user_resource.name if user_resource else resource.file_name
    url = storage.generate_download_url(
        resource.content_hash,
        folder="raw",
        filename=f"{name}.pdf",
        expires_in=3600,
    )

    return {"url": url, "filename": f"{name}.pdf"}


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
    if not ur_result.scalar_one_or_none() and not resource.is_public:
        raise HTTPException(status_code=403, detail="Resource not accessible")

    # Generate URL
    if not storage.file_exists(resource.content_hash, folder="thumbnails"):
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
            from app.services import RedisService

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
    - For incomplete: queue only incomplete pages
    - For completed: return error (already done)

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

    # Enqueue prepare_extraction job (handles rendering + page job queueing)
    from app.services import RedisService

    settings = get_settings()
    redis = RedisService(settings.redis_url)
    job_id = await redis.enqueue_job("prepare_extraction", resource_id)
    await redis.close()

    return {
        "message": "Extraction queued",
        "resource_id": resource_id,
        "job_id": job_id,
    }
