"""
Deck model, User-owned card organization.

Each deck belongs to a single user and contains cards.
Supports nested decks for hierarchical organization.
"""

from datetime import datetime

from sqlalchemy import Column, Index, text
from sqlmodel import Field, SQLModel

from app.core.datetime_utils import TimestampTZ, utc_now


class Deck(SQLModel, table=True):
    """
    Deck model for organizing cards.

    Each deck belongs to exactly one user.
    Supports parent-child relationships for nested deck hierarchies.
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

    # Hierarchy (optional nesting)
    parent_id: int | None = Field(
        default=None,
        foreign_key="decks.id",
        index=True,
        description="Parent deck for nested organization",
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
