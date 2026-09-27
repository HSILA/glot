"""cascade page extractions on resource delete

Revision ID: 0007_page_extractions_cascade
Revises: 0006_card_front_lemma
Create Date: 2026-09-26

Deleting a resource with extraction history used to fail: the
page_extractions.resource_id FK had no ON DELETE CASCADE, so the DELETE
raised an IntegrityError while the session committed after the API had
already returned 204 (issue #22). Extraction rows are derived data with no
meaning once their resource is gone, so cascade the delete.

This migration drops the existing FK constraint and re-adds it with
ON DELETE CASCADE. The constraint was autocreated by PostgreSQL, so it
follows the convention <table>_<column>_fkey.
"""

from alembic import op

revision: str = "0007_page_extractions_cascade"
down_revision: str | None = "0006_card_front_lemma"
branch_labels: str | None = None
depends_on: str | None = None

CONSTRAINT_NAME = "page_extractions_resource_id_fkey"


def upgrade() -> None:
    op.drop_constraint(CONSTRAINT_NAME, "page_extractions", type_="foreignkey")
    op.create_foreign_key(
        CONSTRAINT_NAME,
        source_table="page_extractions",
        referent_table="resources",
        local_cols=["resource_id"],
        remote_cols=["id"],
        ondelete="CASCADE",
    )


def downgrade() -> None:
    op.drop_constraint(CONSTRAINT_NAME, "page_extractions", type_="foreignkey")
    op.create_foreign_key(
        CONSTRAINT_NAME,
        source_table="page_extractions",
        referent_table="resources",
        local_cols=["resource_id"],
        remote_cols=["id"],
    )
