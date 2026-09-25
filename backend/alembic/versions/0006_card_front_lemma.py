"""Add and backfill a lemma for plain one-word card fronts.

The eligibility and normalization rules in this migration are local on purpose.
Do not import the live application helper here. Future rule changes must not
change the backfill behavior of this revision.

Revision ID: 0006_card_front_lemma
Revises: 0005_review_logs_cascade
Create Date: 2026-09-24
"""

import re
import unicodedata

import simplemma
import sqlalchemy as sa

from alembic import op

revision: str = "0006_card_front_lemma"
down_revision: str | None = "0005_review_logs_cascade"
branch_labels: str | None = None
depends_on: str | None = None

BATCH_SIZE = 500
MAX_FRONT_WORD_LENGTH = 255
_SINGLE_WORD_PATTERN = re.compile(r"[^\W_]+", re.UNICODE)


def _migration_front_lemma(front_content: str) -> str | None:
    """Return a lemma for one plain word using this revision's fixed rules."""
    normalized = unicodedata.normalize("NFC", front_content).strip()
    normalized = unicodedata.normalize("NFC", normalized.lower())
    if (
        not normalized
        or len(normalized) > MAX_FRONT_WORD_LENGTH
        or _SINGLE_WORD_PATTERN.fullmatch(normalized) is None
    ):
        return None
    lemma = simplemma.lemmatize(normalized, lang="fr", greedy=False)
    if len(lemma) > MAX_FRONT_WORD_LENGTH:
        return None
    return lemma


def upgrade() -> None:
    """Add the indexed column and backfill eligible existing fronts."""
    op.add_column(
        "cards",
        sa.Column("front_lemma", sa.String(length=255), nullable=True),
    )
    op.create_index(
        "ix_cards_front_lemma_deck",
        "cards",
        ["front_lemma", "deck_id"],
        unique=False,
    )
    _backfill_existing_cards()


def _backfill_existing_cards() -> None:
    """Update eligible fronts in bounded batches."""
    connection = op.get_bind()
    cards = sa.table(
        "cards",
        sa.column("id", sa.Integer),
        sa.column("front_content", sa.String),
    )
    last_id: int | None = None

    while True:
        statement = (
            sa.select(cards.c.id, cards.c.front_content)
            .order_by(cards.c.id)
            .limit(BATCH_SIZE)
        )
        if last_id is not None:
            statement = statement.where(cards.c.id > last_id)
        rows = connection.execute(statement).all()
        if not rows:
            break

        updates: list[dict[str, str | int]] = []
        for card_id, front_content in rows:
            last_id = card_id
            lemma = _migration_front_lemma(front_content)
            if lemma is not None:
                updates.append({"card_id": card_id, "lemma": lemma})
        if updates:
            connection.execute(
                sa.text("UPDATE cards SET front_lemma = :lemma WHERE id = :card_id"),
                updates,
            )


def downgrade() -> None:
    """Remove the lemma index and column."""
    op.drop_index("ix_cards_front_lemma_deck", table_name="cards")
    op.drop_column("cards", "front_lemma")
