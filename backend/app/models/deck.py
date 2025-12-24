"""
Deck model - Optional card organization.

Supports nested decks for hierarchical organization.
Useful for future Anki export compatibility.
"""
from datetime import datetime

from sqlalchemy import text
from sqlmodel import Field, SQLModel


class Deck(SQLModel, table=True):
    """
    Deck model for organizing cards.

    Supports parent-child relationships for nested deck hierarchies.
    """

    __tablename__ = "decks"

    id: int | None = Field(default=None, primary_key=True)
    name: str = Field(min_length=1, max_length=255, index=True)
    description: str | None = Field(default=None, max_length=1000)
    parent_id: int | None = Field(default=None, foreign_key="decks.id", index=True)

    # Timestamps
    created_at: datetime = Field(
        default_factory=datetime.utcnow,
        sa_column_kwargs={"server_default": text("now()")},
    )
    updated_at: datetime = Field(
        default_factory=datetime.utcnow,
        sa_column_kwargs={"server_default": text("now()"), "onupdate": datetime.utcnow},
    )
