"""
ReviewLog model, historical review data for flashcards.

Each review event is logged with the card state before the review,
enabling future algorithm optimization personalized to the user.

Ownership: ReviewLogs inherit user ownership via card_id → cards.deck_id → decks.user_id
"""

from datetime import datetime

from sqlalchemy import Column, Index, text
from sqlmodel import Field, SQLModel

from app.core.datetime_utils import TimestampTZ, utc_now


class ReviewLog(SQLModel, table=True):
    """
    Review history log for algorithm optimization.

    Captures the complete state before each review to enable
    future optimization of scheduling parameters.

    NOTE: This table grows very large (one row per review).
    Composite indexes are critical for performance.

    Fields:
        - rating: User's rating (1=Again, 2=Hard, 3=Good, 4=Easy)
        - stability_before: Card stability before this review
        - difficulty_before: Card difficulty before this review
        - scheduled_days: The interval that was scheduled
        - elapsed_days: Actual days since last review
        - review_duration_ms: Optional time taken to answer
    """

    __tablename__ = "review_logs"
    __table_args__ = (
        # Composite index for optimizer: get all reviews for a card ordered by time
        Index("ix_review_logs_card_time", "card_id", "reviewed_at"),
        # Index for time-range queries (analytics, data export)
        Index("ix_review_logs_reviewed_at", "reviewed_at"),
    )

    id: int | None = Field(default=None, primary_key=True)
    card_id: int = Field(
        foreign_key="cards.id",
        index=True,
        description="Card that was reviewed",
    )

    # Review data
    rating: int = Field(
        ge=1,
        le=4,
        description="User rating: 1=Again, 2=Hard, 3=Good, 4=Easy",
    )
    reviewed_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(TimestampTZ, server_default=text("now()"), nullable=False),
        description="When the review occurred",
    )
    review_duration_ms: int | None = Field(
        default=None,
        ge=0,
        description="Time user spent answering (milliseconds)",
    )

    # State BEFORE review (for algorithm optimization)
    stability_before: float = Field(
        ge=0.0,
        description="Card stability before this review",
    )
    difficulty_before: float = Field(
        ge=1.0,
        le=10.0,
        description="Card difficulty before this review",
    )
    state_before: str = Field(
        max_length=20,
        description="Card state before review (new/learning/review/relearning)",
    )

    # Interval data
    scheduled_days: int = Field(
        ge=0,
        description="The interval that was scheduled",
    )
    elapsed_days: int = Field(
        ge=0,
        description="Actual days since last review",
    )
