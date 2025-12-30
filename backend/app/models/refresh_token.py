"""
RefreshToken model for multi-device session management.

Each row represents an active session on a specific device.
Tokens are rotated on each refresh (rolling sessions).
"""

# TODO: Add scheduled cleanup job to delete expired tokens periodically.
# Currently expired tokens are cleaned up lazily during refresh attempts.

from datetime import datetime

from sqlalchemy import Column, Index, text
from sqlmodel import Field, SQLModel

from app.core.datetime_utils import TimestampTZ, utc_now


class RefreshToken(SQLModel, table=True):
    """
    Refresh token storage for multi-device authentication.

    Features:
    - One token per device per user
    - Token is hashed (SHA256) for security
    - Rolling expiry: token is replaced on each refresh
    - Device tracking via User-Agent parsing

    Security:
    - Raw tokens are never stored, only SHA256 hashes
    - Expired tokens are cleaned up periodically
    - Token reuse detection (if hash not found, possible theft)
    """

    __tablename__ = "refresh_tokens"
    __table_args__ = (
        # Composite index for cleanup queries
        Index("ix_refresh_tokens_user_expires", "user_id", "expires_at"),
    )

    id: int | None = Field(default=None, primary_key=True)
    user_id: int = Field(
        foreign_key="users.id",
        index=True,
        description="User who owns this session",
    )

    # Token (hashed with SHA256)
    token_hash: str = Field(
        max_length=64,  # SHA256 produces 64 hex characters
        index=True,
        unique=True,
        description="SHA256 hash of the refresh token",
    )

    # Device identification
    device_name: str | None = Field(
        default=None,
        max_length=255,
        description="Parsed from User-Agent, e.g., 'iPhone (iOS)'",
    )

    # Expiry (rolling - extended on each refresh)
    expires_at: datetime = Field(
        sa_column=Column(TimestampTZ, index=True, nullable=False),
        description="When this token expires",
    )

    # Audit timestamps
    created_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(TimestampTZ, server_default=text("now()"), nullable=False),
        description="When this session was created (first login)",
    )
    last_used_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(TimestampTZ, nullable=False),
        description="When this token was last used for refresh",
    )
