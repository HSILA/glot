"""
ReviewSubmission model — idempotency receipts for card reviews.

A review submission carries a client-generated ``request_id``. The first time
the server records a review for that key it stores a snapshot of the response;
any later retry with the same key (a lost response, a flaky connection, a
resumed outbox after reload) is answered from the snapshot instead of applying
the rating twice.

Why a dedicated table instead of a unique index on ``review_logs``:

- The receipt must answer replays even after the card (and its logs, which
  cascade) is deleted, so it keeps ``card_id`` and the snapshot without
  foreign keys to either.
- The receipt is claimed with an ``INSERT ... ON CONFLICT DO NOTHING`` at the
  very start of the request, so two concurrent duplicates cannot both proceed.

Ownership: a receipt belongs to one user (reviews are only deduplicated per
user); deleting the user cascades.
"""

from datetime import datetime
from uuid import UUID

from sqlalchemy import Column, ForeignKey, Integer, String, UniqueConstraint, Uuid, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel

from app.core.datetime_utils import TimestampTZ, utc_now


class ReviewSubmission(SQLModel, table=True):
    """Idempotency receipt for one recorded review submission."""

    __tablename__ = "review_submissions"
    __table_args__ = (
        UniqueConstraint(
            "user_id", "request_id", name="ux_review_submissions_user_request"
        ),
    )

    id: int | None = Field(default=None, primary_key=True)

    user_id: int = Field(
        sa_column=Column(
            Integer,
            ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        description="User the submission was made by",
    )
    request_id: UUID = Field(
        sa_column=Column(Uuid, nullable=False),
        description="Client-generated idempotency key for this review submission",
    )
    fingerprint: str = Field(
        sa_column=Column(String(64), nullable=False),
        description="SHA-256 of the submission payload; detects key reuse with different content",
    )
    card_id: int = Field(
        sa_column=Column(Integer, nullable=False),
        description="Card the review was submitted for (kept even if the card is deleted)",
    )
    review_log_id: int | None = Field(
        default=None,
        sa_column=Column(Integer, nullable=True),
        description="ReviewLog row created by this submission (no FK: logs cascade-away with cards)",
    )
    response_json: dict = Field(
        sa_column=Column(JSONB, nullable=False),
        description="Snapshot of the review response returned to the client",
    )
    created_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(TimestampTZ, server_default=text("now()"), nullable=False),
    )
