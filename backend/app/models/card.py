"""
Card model - The core flashcard entity.

This model uses a "single table" design with JSONB metadata for flexibility,
allowing different card types (vocab, phrase, generic, etc.) to store
type-specific data without schema changes.
"""
from datetime import datetime
from enum import Enum
from typing import Any

from sqlalchemy import Column, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel


class CardState(str, Enum):
    """FSRS card states during the learning process."""

    NEW = "new"
    LEARNING = "learning"
    REVIEW = "review"
    RELEARNING = "relearning"


class Card(SQLModel, table=True):
    """
    Flashcard model with FSRS scheduling.



    Content Fields:
        - front_content: The question/cue (Markdown supported)
        - back_content: The answer/reveal (Markdown supported)
        - meta_data: Type-specific fields as JSONB
        - tags: List of tags for organization and Anki export

    FSRS Scheduling Fields:
        - difficulty: Card difficulty (1-10)
        - stability: Memory stability in days
        - state: Current learning state
        - reps: Total successful reviews
        - lapses: Times forgotten (rated "Again")
    """

    __tablename__ = "cards"

    id: int | None = Field(default=None, primary_key=True)

    # Content
    front_content: str = Field(min_length=1, max_length=10000)
    back_content: str = Field(min_length=1, max_length=10000)
    meta_data: dict[str, Any] = Field(
        default_factory=dict,
        sa_column=Column(JSONB, nullable=False, server_default=text("'{}'")),
    )
    tags: list[str] = Field(
        default_factory=list,
        sa_column=Column(JSONB, nullable=False, server_default=text("'[]'")),
    )

    # Organization (for future Anki export)
    deck_id: int | None = Field(default=None, foreign_key="decks.id", index=True)

    # FSRS Scheduling Fields
    difficulty: float = Field(default=5.0, ge=1.0, le=10.0)
    stability: float = Field(default=0.0, ge=0.0)
    state: CardState = Field(default=CardState.NEW, index=True)
    reps: int = Field(default=0, ge=0)
    lapses: int = Field(default=0, ge=0)

    # Timestamps
    last_review_at: datetime | None = Field(default=None)
    next_review_at: datetime | None = Field(default=None, index=True)
    created_at: datetime = Field(
        default_factory=datetime.utcnow,
        sa_column_kwargs={"server_default": text("now()")},
    )
    updated_at: datetime = Field(
        default_factory=datetime.utcnow,
        sa_column_kwargs={"server_default": text("now()"), "onupdate": datetime.utcnow},
    )
