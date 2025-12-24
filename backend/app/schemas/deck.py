"""
Deck schemas for API request/response validation.
"""
from datetime import datetime

from pydantic import BaseModel, Field


class DeckCreate(BaseModel):
    """Schema for creating a new deck."""

    name: str = Field(min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=1000)
    parent_id: int | None = None


class DeckUpdate(BaseModel):
    """Schema for updating an existing deck."""

    name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = None
    parent_id: int | None = None


class DeckRead(BaseModel):
    """Schema for reading a deck (response)."""

    id: int
    name: str
    description: str | None
    parent_id: int | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
