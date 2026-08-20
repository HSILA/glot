"""track server-side upload confirmation

Revision ID: 0003_upload_confirmation
Revises: 0002_is_active_default_false
Create Date: 2026-08-20

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0003_upload_confirmation"
down_revision: str | Sequence[str] | None = "0002_is_active_default_false"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Mark legacy resources confirmed and default future non-upload inserts to confirmed."""
    op.add_column(
        "resources",
        sa.Column(
            "upload_confirmed",
            sa.Boolean(),
            server_default=sa.text("true"),
            nullable=False,
        ),
    )


def downgrade() -> None:
    """Remove explicit upload confirmation state."""
    op.drop_column("resources", "upload_confirmed")
