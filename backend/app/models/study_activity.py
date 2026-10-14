"""StudyActivityEvent model — durable daily study-activity projection.

One row per committed review rating, projected from ``review_logs`` so the
study calendar survives card deletion (logs cascade away with their card;
this table does not).

Why a projection instead of querying review_logs:
- Ownership here is direct (user_id FK with ON DELETE CASCADE), so hard user
  deletion cleans up automatically without a join through cards/decks.
- Card or deck deletion must not erase a study habit; review_logs cascade on
  card delete (migration 0005), this table never cascades from cards.
- ``review_log_id`` is unique but has NO foreign key: log ids are never
  reused (integer sequences), and the projection must outlive the log.
"""

from datetime import datetime

from sqlalchemy import Column, ForeignKey, Index, Integer, UniqueConstraint, text
from sqlmodel import Field, SQLModel

from app.core.datetime_utils import TimestampTZ, utc_now


class StudyActivityEvent(SQLModel, table=True):
    """One committed review rating, projected for the study activity calendar."""

    __tablename__ = "study_activity_events"
    __table_args__ = (
        # Backfill reruns and projection inserts dedupe on the log id.
        UniqueConstraint("review_log_id", name="ux_study_activity_review_log"),
        # Daily aggregation for one user (the calendar/streak read path).
        Index("ix_study_activity_user_time", "user_id", "reviewed_at"),
    )

    id: int | None = Field(default=None, primary_key=True)

    user_id: int = Field(
        sa_column=Column(
            Integer,
            ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        description="User who earned the activity (direct owner; cascade on account delete)",
    )

    review_log_id: int = Field(
        sa_column=Column(Integer, nullable=False),
        description="Originating review_logs.id (unique, no FK by design)",
    )

    reviewed_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(TimestampTZ, server_default=text("now()"), nullable=False),
        description="Exact UTC timestamp copied from the originating review log",
    )
