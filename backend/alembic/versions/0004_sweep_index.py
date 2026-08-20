"""index abandoned upload reservations

Revision ID: 0004_sweep_index
Revises: 0003_upload_confirmation
Create Date: 2026-08-20

Adds a partial index on (uploaded_at) WHERE upload_confirmed = FALSE so the
startup expired-upload sweeper finds abandoned reservations without a full
table scan on every worker restart.

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0004_sweep_index"
down_revision: str | Sequence[str] | None = "0003_upload_confirmation"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Index unconfirmed upload reservations for the sweeper query."""
    op.create_index(
        "idx_resources_unconfirmed_uploaded_at",
        "resources",
        ["uploaded_at"],
        postgresql_where=sa.text("upload_confirmed = FALSE"),
    )


def downgrade() -> None:
    """Drop the abandoned-upload sweeper index."""
    op.drop_index("idx_resources_unconfirmed_uploaded_at", table_name="resources")
