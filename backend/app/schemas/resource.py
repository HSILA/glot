"""
Resource schemas for API request/response validation.
"""

from datetime import datetime

from pydantic import BaseModel, Field

from app.models.resource import ExtractionStatus


class UploadRequest(BaseModel):
    """Request to initiate a file upload."""

    name: str = Field(..., min_length=1, max_length=255, description="User's custom name for the resource")
    file_name: str = Field(..., min_length=1, max_length=255, description="Original file name")
    size_bytes: int = Field(..., gt=0, description="File size in bytes")
    content_hash: str = Field(
        ...,
        min_length=64,
        max_length=64,
        description="SHA-256 hash of file content (computed client-side)",
    )
    page_count: int = Field(..., gt=0, description="Number of pages in PDF")
    is_public: bool = Field(default=False, description="Whether resource is public")


class UploadResponse(BaseModel):
    """Response with presigned URL for upload."""

    upload_url: str = Field(..., description="Presigned URL for PUT upload")
    resource_id: int = Field(..., description="Temporary resource ID")
    expires_in: int = Field(default=900, description="URL expiration in seconds")


class UploadConfirmRequest(BaseModel):
    """Request to confirm upload completion."""

    content_hash: str = Field(
        ...,
        min_length=64,
        max_length=64,
        description="SHA-256 hash of uploaded file",
    )
    page_count: int = Field(..., gt=0, description="Number of pages in PDF")


class ResourceRead(BaseModel):
    """Resource response model."""

    id: int
    content_hash: str
    name: str  # From user_resources junction
    size_bytes: int
    page_count: int | None
    is_public: bool
    extraction_status: ExtractionStatus
    uploaded_at: datetime
    processed_at: datetime | None
    is_owner: bool = Field(..., description="Whether current user is the uploader")

    model_config = {"from_attributes": True}


class ResourceListResponse(BaseModel):
    """Paginated list of resources."""

    items: list[ResourceRead]
    total: int
    limit: int
    offset: int


class ExtractionProgressResponse(BaseModel):
    """Extraction progress status."""

    status: ExtractionStatus
    progress: int = Field(default=0, ge=0, le=100, description="Progress percentage")
    current_page: int | None = None
    total_pages: int | None = None


class AddPublicResourceRequest(BaseModel):
    """Request to add a public resource to user's library."""

    name: str = Field(..., min_length=1, max_length=255, description="Custom name")


class ResourceUpdateRequest(BaseModel):
    """Update a resource (name, visibility)."""

    name: str | None = Field(None, min_length=1, max_length=255)
    is_public: bool | None = None
