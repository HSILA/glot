"""cascade review_logs on card delete

Revision ID: 0005_review_cascade
Revises: 0004_sweep_index
Create Date: 2026-08-20

Deleting a card with review history used to fail: review_logs.card_id pointed at
cards.id with no ON DELETE CASCADE, so the DELETE raised an IntegrityError after
the API had already returned 204 (the session dependency commits in post-response
teardown). Review history has no meaning without its card, so cascade it.

This migration drops the existing FK constraint and re-adds it with
ON DELETE CASCADE. The constraint was autocreated by PostgreSQL, so it follows
the convention <table>_<column>_fkey.
"""

from alembic import op

revision: str = "0005_review_logs_cascade"
down_revision: str | None = "0004_sweep_index"
branch_labels: str | None = None
depends_on: str | None = None

CONSTRAINT_NAME = "review_logs_card_id_fkey"


def upgrade() -> None:
    op.drop_constraint(CONSTRAINT_NAME, "review_logs", type_="foreignkey")
    op.create_foreign_key(
        CONSTRAINT_NAME,
        source_table="review_logs",
        referent_table="cards",
        local_cols=["card_id"],
        remote_cols=["id"],
        ondelete="CASCADE",
    )


def downgrade() -> None:
    op.drop_constraint(CONSTRAINT_NAME, "review_logs", type_="foreignkey")
    op.create_foreign_key(
        CONSTRAINT_NAME,
        source_table="review_logs",
        referent_table="cards",
        local_cols=["card_id"],
        remote_cols=["id"],
    )
