"""
Resource model - Global resource storage with content-based deduplication.

Stores PDF documents with extraction status tracking.
Content hash (SHA-256) ensures deduplication at storage level.
"""

from datetime import datetime
from enum import Enum

from sqlalchemy import Column, Index, text
from sqlmodel import Field, SQLModel

from app.core.datetime_utils import TimestampTZ, utc_now


class ExtractionStatus(str, Enum):
    """Extraction processing status."""

    NONE = "none"
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"


class Resource(SQLModel, table=True):
    """
    Global resource storage with content-based deduplication.

    Fields:
        - content_hash: SHA-256 hash of file content (unique identifier)
        - size_bytes: File size in bytes
        - page_count: Number of pages in PDF
        - is_public: Whether resource is visible to all users
        - extraction_status: Current extraction processing status
        - uploaded_at: When the resource was first uploaded
        - processed_at: When extraction completed
        - uploaded_by: User who originally uploaded this resource
    """

    __tablename__ = "resources"
    __table_args__ = (
        Index(
            "idx_resources_public",
            "is_public",
            postgresql_where=text("is_public = TRUE"),
        ),
    )

    id: int | None = Field(default=None, primary_key=True)

    # Content identification
    content_hash: str = Field(
        max_length=64,
        unique=True,
        index=True,
        description="SHA-256 hash of file content",
    )

    # File metadata
    size_bytes: int = Field(
        description="File size in bytes",
    )
    page_count: int | None = Field(
        default=None,
        description="Number of pages in PDF",
    )
    file_name: str = Field(
        max_length=255,
        description="Original filename from upload (immutable)",
    )

    # Visibility
    is_public: bool = Field(
        default=False,
        description="Whether resource is visible to all users",
    )

    # Extraction tracking
    extraction_status: ExtractionStatus = Field(
        default=ExtractionStatus.NONE,
        description="Current extraction processing status",
    )

    # Timestamps
    uploaded_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(TimestampTZ, server_default=text("now()"), nullable=False),
        description="When the resource was first uploaded",
    )
    processed_at: datetime | None = Field(
        default=None,
        sa_column=Column(TimestampTZ, nullable=True),
        description="When extraction completed",
    )

    # Ownership
    uploaded_by: int = Field(
        foreign_key="users.id",
        description="User who originally uploaded this resource",
    )


class PageStatus(str, Enum):
    """Per-page extraction status."""

    PENDING = "pending"  # Not yet processed
    PROCESSING = "processing"  # Currently being extracted
    COMPLETED = "completed"  # Successfully extracted


class PageExtraction(SQLModel, table=True):
    """
    Per-page extraction tracking for crash recovery and progress.

    Each page is tracked independently, allowing:
    - Resume after worker crash
    - Retry individual failed pages
    - Accurate progress reporting
    """

    __tablename__ = "page_extractions"
    __table_args__ = (
        Index("idx_page_extractions_resource", "resource_id"),
        Index("idx_page_extractions_status", "status"),
    )

    id: int | None = Field(default=None, primary_key=True)

    # Link to resource
    resource_id: int = Field(
        foreign_key="resources.id",
        index=True,
        description="Parent resource",
    )

    # Page identification
    page_number: int = Field(
        description="Page number (1-indexed)",
    )

    # Status tracking
    status: PageStatus = Field(
        default=PageStatus.PENDING,
        description="Current extraction status",
    )
    attempts: int = Field(
        default=0,
        description="Number of extraction attempts",
    )
    last_error: str | None = Field(
        default=None,
        max_length=1000,
        description="Error message from last failed attempt",
    )

    # Timestamps
    created_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(TimestampTZ, server_default=text("now()"), nullable=False),
    )
    started_at: datetime | None = Field(
        default=None,
        sa_column=Column(TimestampTZ, nullable=True),
        description="When extraction started",
    )
    completed_at: datetime | None = Field(
        default=None,
        sa_column=Column(TimestampTZ, nullable=True),
        description="When extraction completed",
    )
