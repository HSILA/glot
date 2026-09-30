"""
Shared due-card counting and batch selection for the study session.

The study session and the dashboard must agree on one question: how many cards
are waiting to be studied, and which of them come next. Three consumers need
this:

- The session header shows how many cards remain — it must equal the
  dashboard's "cards to study" number for the same scope.
- The session queue loads the next priority-ordered batch, repeatedly, until
  the scope is genuinely empty (batch continuation).
- Review responses return a fresh count so the header stays truthful after
  every recorded rating.

"Study-eligible" means either the card is due for review
(``next_review_at <= as_of``) or it has never been studied (``state == NEW``).
This mirrors the per-deck counters in ``app/api/v1/decks.py`` exactly, so the
dashboard's deck chips and the session header can never drift apart.

The batch statement returns the selected rows and the scope counts from a
single SQL statement (window aggregates over the same filtered set), so a
returned batch and its counts are always one consistent snapshot: an empty
batch can only mean the scope is empty, never a lost count.
"""

from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import and_, case, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql import Select
from sqlalchemy.sql.elements import ColumnElement
from sqlmodel import select

from app.models import Card, CardState, Deck


@dataclass(frozen=True, slots=True)
class StudyScopeCounts:
    """Study-eligible card counts for one scope (all decks or one deck)."""

    scheduled_due_count: int
    new_count: int
    total: int


def study_eligible_clause(as_of: datetime) -> ColumnElement[bool]:
    """Cards that are waiting to be studied at ``as_of``."""
    return (Card.next_review_at <= as_of) | (Card.state == CardState.NEW)


def _scheduled_due_case(as_of: datetime):
    """1 for scheduled cards actually due (NEW cards are counted separately)."""
    return case(
        (and_(Card.state != CardState.NEW, Card.next_review_at <= as_of), 1),
        else_=0,
    )


def _new_case():
    """1 for never-studied cards."""
    return case((Card.state == CardState.NEW, 1), else_=0)


def due_priority_case():
    """Selection priority for which cards make a batch cut (lower = sooner).

    Learning/relearning first (most fragile), then due reviews, then new.
    """
    return case(
        (Card.state.in_((CardState.LEARNING, CardState.RELEARNING)), 0),
        (Card.state == CardState.REVIEW, 1),
        else_=2,
    )


def build_study_summary_statement(
    *,
    user_id: int,
    as_of: datetime,
    deck_id: int | None = None,
) -> Select:
    """Counts-only statement for one study scope (single round trip)."""
    stmt = (
        select(
            func.coalesce(func.sum(_scheduled_due_case(as_of)), 0),
            func.coalesce(func.sum(_new_case()), 0),
        )
        .select_from(Card)
        .join(Deck, Card.deck_id == Deck.id)
        .where(Deck.user_id == user_id, study_eligible_clause(as_of))
    )
    if deck_id is not None:
        stmt = stmt.where(Card.deck_id == deck_id)
    return stmt


def build_due_batch_statement(
    *,
    user_id: int,
    as_of: datetime,
    limit: int,
    deck_id: int | None = None,
) -> Select:
    """Batch + counts in one statement.

    Each returned row is ``(Card, scheduled_due_count, new_count)`` where the
    counts are window aggregates over the whole eligible set — the same rows
    the ``LIMIT`` is cutting from — so an empty result provably means the
    scope is empty (counts are all zero).
    """
    scheduled_due_window = func.sum(_scheduled_due_case(as_of)).over().label(
        "scheduled_due_count"
    )
    new_window = func.sum(_new_case()).over().label("new_count")

    stmt = (
        select(Card, scheduled_due_window, new_window)
        .join(Deck, Card.deck_id == Deck.id)
        .where(Deck.user_id == user_id, study_eligible_clause(as_of))
        .order_by(
            due_priority_case().asc(),
            Card.next_review_at.asc().nullsfirst(),
            # Stable tie-breaker so scoped batches are deterministic even when
            # many cards share priority and timestamp (e.g. a pile of new cards).
            Card.id.asc(),
        )
        .limit(limit)
    )
    if deck_id is not None:
        stmt = stmt.where(Card.deck_id == deck_id)
    return stmt


async def fetch_study_counts(
    session: AsyncSession,
    *,
    user_id: int,
    as_of: datetime,
    deck_id: int | None = None,
) -> StudyScopeCounts:
    """Run the counts query and return the scope totals."""
    row = (
        await session.execute(
            build_study_summary_statement(user_id=user_id, as_of=as_of, deck_id=deck_id)
        )
    ).one()
    scheduled_due = int(row[0] or 0)
    new = int(row[1] or 0)
    return StudyScopeCounts(
        scheduled_due_count=scheduled_due,
        new_count=new,
        total=scheduled_due + new,
    )


async def fetch_due_batch(
    session: AsyncSession,
    *,
    user_id: int,
    as_of: datetime,
    limit: int,
    deck_id: int | None = None,
) -> tuple[list[Card], StudyScopeCounts]:
    """Run the batch query; the counts describe the whole scope, not the batch."""
    rows = (
        await session.execute(
            build_due_batch_statement(
                user_id=user_id, as_of=as_of, limit=limit, deck_id=deck_id
            )
        )
    ).all()

    if not rows:
        return [], StudyScopeCounts(scheduled_due_count=0, new_count=0, total=0)

    cards = [row[0] for row in rows]
    scheduled_due = int(rows[0][1] or 0)
    new = int(rows[0][2] or 0)
    return cards, StudyScopeCounts(
        scheduled_due_count=scheduled_due,
        new_count=new,
        total=scheduled_due + new,
    )
