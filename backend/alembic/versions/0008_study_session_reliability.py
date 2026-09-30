"""study-session reliability: review receipts + card review_version

Revision ID: 0008_study_session_reliability
Revises: 0007_page_extractions_cascade
Create Date: 2026-09-29

Two schema additions for idempotent review recording:

- ``review_submissions``: one row per accepted review submission, keyed by
  (user_id, request_id). Stores a payload fingerprint and the response
  snapshot so a retried submission is answered from the receipt instead of
  applying the rating twice. No FK to ``cards`` on purpose: the receipt must
  still answer replays after the card (and its cascade-deleted review logs)
  is gone. Deleting the user cascades receipts.

- ``cards.review_version``: monotonically incremented on every recorded
  review. Clients echo the version they saw when the card was loaded, so a
  stale submission made against an older snapshot is rejected with 409
  instead of silently overwriting newer scheduling.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0008_study_session_reliability"
down_revision: str | Sequence[str] | None = "0007_page_extractions_cascade"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add the review_version column and the review_submissions receipt table."""
    op.add_column(
        "cards",
        sa.Column(
            "review_version",
            sa.Integer(),
            server_default=sa.text("0"),
            nullable=False,
        ),
    )
    op.create_table(
        "review_submissions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("request_id", sa.Uuid(), nullable=False),
        sa.Column("fingerprint", sa.String(length=64), nullable=False),
        sa.Column("card_id", sa.Integer(), nullable=False),
        sa.Column("review_log_id", sa.Integer(), nullable=True),
        sa.Column("response_json", postgresql.JSONB(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.UniqueConstraint(
            "user_id", "request_id", name="ux_review_submissions_user_request"
        ),
    )


def downgrade() -> None:
    """Drop the receipt table and the review_version column."""
    op.drop_table("review_submissions")
    op.drop_column("cards", "review_version")
