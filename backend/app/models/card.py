"""
Card model, The core flashcard entity.

This model uses a "single table" design with JSONB metadata for flexibility,
allowing different card types (vocab, phrase, generic, etc.) to store
type-specific data without schema changes.

Cards belong to a deck, which belongs to a user. This provides user
ownership without adding user_id directly to cards.
"""

from datetime import datetime
from enum import Enum
from typing import Any

from sqlalchemy import Column, Index, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel

from app.core.datetime_utils import TimestampTZ, utc_now


class CardState(str, Enum):
    """Card states during the learning process."""

    NEW = "new"
    LEARNING = "learning"
    REVIEW = "review"
    RELEARNING = "relearning"


class Card(SQLModel, table=True):
    """
    Flashcard model with spaced repetition scheduling.

    Ownership: Cards inherit user ownership via deck_id → decks.user_id

    Content Fields:
        - front_content: The question/cue (Markdown supported)
        - back_content: The answer/reveal (Markdown supported)
        - meta_data: Type-specific fields as JSONB
        - tags: List of tags for organization

    Scheduling Fields:
        - difficulty: Card difficulty (1-10)
        - stability: Memory stability in days
        - state: Current learning state
        - reps: Total successful reviews
        - lapses: Times forgotten (rated "Again")
    """

    __tablename__ = "cards"
    __table_args__ = (
        # Composite index for "due cards in deck" query (most common query)
        Index("ix_cards_deck_next_review", "deck_id", "next_review_at"),
        # Composite index for "cards by state in deck" query
        Index("ix_cards_deck_state", "deck_id", "state"),
        # Enforce stable per-deck sequence uniqueness (gaps allowed)
        UniqueConstraint("deck_id", "sequence", name="ux_cards_deck_sequence"),
    )

    id: int | None = Field(default=None, primary_key=True)

    # Deck-local sequence number (stable creation order within a deck)
    # NOTE: This is NOT the global card id.
    sequence: int = Field(
        description="Deck-local incremental number assigned on creation (1..N, may have gaps after deletes)",
        index=True,
    )

    # Organization (REQUIRED - cards must belong to a deck)
    deck_id: int = Field(
        foreign_key="decks.id",
        index=True,
        description="Deck this card belongs to (required)",
    )

    # Content
    front_content: str = Field(
        min_length=1,
        max_length=10000,
        description="Question/cue side (Markdown)",
    )
    back_content: str = Field(
        min_length=1,
        max_length=10000,
        description="Answer/reveal side (Markdown)",
    )
    meta_data: dict[str, Any] = Field(
        default_factory=dict,
        sa_column=Column(JSONB, nullable=False, server_default=text("'{}'")),
        description="Type-specific metadata (vocab readings, etc.)",
    )
    tags: list[str] = Field(
        default_factory=list,
        sa_column=Column(JSONB, nullable=False, server_default=text("'[]'")),
        description="Tags for organization and Anki export",
    )

    # Scheduling Fields
    difficulty: float = Field(
        default=5.0,
        ge=1.0,
        le=10.0,
        description="Card difficulty (1=easy, 10=hard)",
    )
    stability: float = Field(
        default=0.0,
        ge=0.0,
        description="Memory stability in days",
    )
    state: CardState = Field(
        default=CardState.NEW,
        index=True,
        description="Current learning state",
    )
    reps: int = Field(
        default=0,
        ge=0,
        description="Total successful review count",
    )
    lapses: int = Field(
        default=0,
        ge=0,
        description="Times forgotten (rated Again)",
    )

    # Timestamps
    last_review_at: datetime | None = Field(
        default=None,
        sa_column=Column(TimestampTZ, nullable=True),
        description="When card was last reviewed",
    )
    next_review_at: datetime | None = Field(
        default=None,
        sa_column=Column(TimestampTZ, index=True, nullable=True),
        description="When card is next due for review",
    )
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
