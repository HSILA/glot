"""
ReviewLog model - Historical review data for FSRS optimizer.

Each review event is logged with the card state before the review,
enabling future retraining of FSRS parameters personalized to the user.
"""
from datetime import datetime

from sqlalchemy import text
from sqlmodel import Field, SQLModel


class ReviewLog(SQLModel, table=True):
    """
    Review history log for FSRS optimizer training.

    Captures the complete state before each review to enable
    machine learning optimization of FSRS parameters.

    Fields:
        - rating: User's rating (1=Again, 2=Hard, 3=Good, 4=Easy)
        - stability_before: Card stability before this review
        - difficulty_before: Card difficulty before this review
        - scheduled_days: The interval that was scheduled
        - elapsed_days: Actual days since last review
        - review_duration_ms: Optional time taken to answer
    """

    __tablename__ = "review_logs"

    id: int | None = Field(default=None, primary_key=True)
    card_id: int = Field(foreign_key="cards.id", index=True)

    # Review data
    rating: int = Field(ge=1, le=4)  # 1=Again, 2=Hard, 3=Good, 4=Easy
    reviewed_at: datetime = Field(
        default_factory=datetime.utcnow,
        sa_column_kwargs={"server_default": text("now()")},
        index=True,
    )
    review_duration_ms: int | None = Field(default=None, ge=0)

    # State BEFORE review (for optimizer training)
    stability_before: float = Field(ge=0.0)
    difficulty_before: float = Field(ge=1.0, le=10.0)
    state_before: str = Field(max_length=20)

    # Interval data
    scheduled_days: int = Field(ge=0)  # The interval that was scheduled
    elapsed_days: int = Field(ge=0)  # Actual days since last review
