"""
Card schemas for API request/response validation.
"""
from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field

from app.models.card import CardState


class CardCreate(BaseModel):
    """Schema for creating a new card."""


    front_content: str = Field(min_length=1, max_length=10000)
    back_content: str = Field(min_length=1, max_length=10000)
    meta_data: dict[str, Any] = Field(default_factory=dict)
    tags: list[str] = Field(default_factory=list)
    deck_id: int | None = None


class CardUpdate(BaseModel):
    """Schema for updating an existing card."""


    front_content: str | None = Field(default=None, min_length=1, max_length=10000)
    back_content: str | None = Field(default=None, min_length=1, max_length=10000)
    meta_data: dict[str, Any] | None = None
    tags: list[str] | None = None
    deck_id: int | None = None


class CardRead(BaseModel):
    """Schema for reading a card (response)."""

    id: int

    front_content: str
    back_content: str
    meta_data: dict[str, Any]
    tags: list[str]
    deck_id: int | None

    # FSRS fields
    difficulty: float
    stability: float
    state: CardState
    reps: int
    lapses: int

    # Timestamps
    last_review_at: datetime | None
    next_review_at: datetime | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ReviewRequest(BaseModel):
    """Request schema for reviewing a card."""

    rating: int = Field(ge=1, le=4, description="1=Again, 2=Hard, 3=Good, 4=Easy")
    review_duration_ms: int | None = Field(
        default=None, ge=0, description="Time taken to answer in milliseconds"
    )


class SchedulingInfo(BaseModel):
    """Scheduling info for a single rating option."""

    interval_days: float
    new_difficulty: float
    new_stability: float


class NextStatesResponse(BaseModel):
    """Response showing next intervals for each rating option."""

    again: SchedulingInfo
    hard: SchedulingInfo
    good: SchedulingInfo
    easy: SchedulingInfo


class ReviewResponse(BaseModel):
    """Response after reviewing a card."""

    card: CardRead
    next_states: NextStatesResponse
    message: str = "Review recorded successfully"
