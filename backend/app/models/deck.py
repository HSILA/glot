"""
Deck model, User-owned card organization.

Each deck belongs to a single user and contains cards.
Flat deck structure (no hierarchy).
"""

from datetime import datetime

from sqlalchemy import Column, Index, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel

from app.core.datetime_utils import TimestampTZ, utc_now


class Deck(SQLModel, table=True):
    """
    Deck model for organizing cards.

    Each deck belongs to exactly one user.
    Flat structure - no nested decks.
    """

    __tablename__ = "decks"
    __table_args__ = (
        # Composite index for user's decks sorted by name
        Index("ix_decks_user_name", "user_id", "name"),
    )

    id: int | None = Field(default=None, primary_key=True)

    # Ownership
    user_id: int = Field(
        foreign_key="users.id",
        index=True,
        description="User who owns this deck",
    )

    # Content
    name: str = Field(
        min_length=1,
        max_length=255,
        description="Deck name",
    )
    description: str | None = Field(
        default=None,
        max_length=1000,
        description="Optional deck description",
    )

    # Presentation metadata
    color: str | None = Field(
        default=None,
        max_length=7,
        description="Hex color code for deck accent (e.g., '#ef4444')",
    )
    tags: list[str] | None = Field(
        default=None,
        sa_column=Column(JSONB, nullable=True),
        description="List of tags for deck organization",
    )

    # Timestamps
    created_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(TimestampTZ, server_default=text("now()"), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(
            TimestampTZ, server_default=text("now()"), onupdate=utc_now, nullable=False
        ),
    )
