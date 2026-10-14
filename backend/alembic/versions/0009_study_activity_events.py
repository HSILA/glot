"""study activity: durable per-user study calendar events

Revision ID: 0009_study_activity_events
Revises: 0008_study_session_reliability
Create Date: 2026-10-11

Adds ``study_activity_events``: one row per committed review rating.

- ``user_id`` FK with ON DELETE CASCADE: activity belongs directly to the
  reviewing user; hard account deletion removes it.
- ``review_log_id`` unique WITHOUT a FK: the projection must survive card
  deletion (review_logs cascade away with their card, migration 0005), and
  uniqueness makes the backfill idempotent (rerunnable, no duplicates).
- ``reviewed_at`` copies the log's exact UTC timestamp; dates are grouped at
  read time in the user's timezone so timezone changes stay recomputable.

Backfill of currently retained logs happens in this migration while review
writes are paused (deploy.sh stops old containers before migrations run and
the new image starts only afterwards), so the transition cannot lose reviews.
Rows deleted with their cards before this migration are gone permanently; the
best streak therefore means "best in available recorded history" (documented
in the activity help text).
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0009_study_activity_events"
down_revision: str | Sequence[str] | None = "0008_study_session_reliability"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create the activity table, backfill retained logs, add the timezone setting."""
    op.create_table(
        "study_activity_events",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("review_log_id", sa.Integer(), nullable=False),
        sa.Column(
            "reviewed_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.UniqueConstraint("review_log_id", name="ux_study_activity_review_log"),
    )
    op.create_index(
        "ix_study_activity_user_time",
        "study_activity_events",
        ["user_id", "reviewed_at"],
    )

    # Backfill retained review logs (ownership via card -> deck -> user).
    # Review writes are paused at this point in the deploy: old containers are
    # stopped before migrations run and the new image starts only afterwards.
    # ON CONFLICT DO NOTHING keeps the statement idempotent for reruns.
    op.execute(
        """
        INSERT INTO study_activity_events (user_id, review_log_id, reviewed_at)
        SELECT d.user_id, rl.id, rl.reviewed_at
        FROM review_logs AS rl
        JOIN cards AS c ON c.id = rl.card_id
        JOIN decks AS d ON d.id = c.deck_id
        ON CONFLICT (review_log_id) DO NOTHING
        """
    )

    # Per-user study-calendar timezone (issue #126 section 3).
    op.add_column(
        "user_settings",
        sa.Column("timezone", sa.String(length=64), nullable=True),
    )


def downgrade() -> None:
    """Drop the timezone column and the activity table."""
    op.drop_column("user_settings", "timezone")
    op.drop_index("ix_study_activity_user_time", table_name="study_activity_events")
    op.drop_table("study_activity_events")
