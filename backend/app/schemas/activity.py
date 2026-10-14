"""Activity schemas for the study calendar endpoint (issue #126)."""

from datetime import datetime

from pydantic import BaseModel, Field


class ActivityDayRead(BaseModel):
    """One calendar date in the activity grid."""

    date: str = Field(description="Local calendar date, YYYY-MM-DD")
    review_count: int = Field(ge=0, description="Committed reviews on this date")


class ActivityResponse(BaseModel):
    """Rolling 365-day study activity with streaks, in one snapshot."""

    as_of: datetime = Field(description="Server UTC snapshot instant")
    timezone: str = Field(description="Effective IANA timezone (UTC fallback)")
    timezone_is_set: bool = Field(description="Whether a timezone choice is persisted")
    today: str = Field(description="Local calendar date for today, YYYY-MM-DD")
    range_start: str = Field(description="First local date of the 365-day grid")
    range_end: str = Field(description="Last local date of the grid (today)")
    next_day_starts_at: datetime = Field(
        description="UTC instant of the next local midnight (refresh hint)"
    )
    today_review_count: int = Field(ge=0)
    current_streak: int = Field(ge=0)
    longest_streak: int = Field(ge=0)
    last_active_date: str | None = Field(
        default=None, description="Most recent active local date, YYYY-MM-DD"
    )
    days: list[ActivityDayRead] = Field(
        min_length=365,
        max_length=365,
        description="Exactly 365 ascending dense local dates (zero days included)",
    )
