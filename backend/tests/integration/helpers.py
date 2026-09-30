"""Shared helpers for PostgreSQL integration tests."""

from datetime import UTC, datetime, timedelta

from sqlalchemy import func
from sqlmodel import select

from app.models import Card, CardState
from app.schemas.card import ReviewRequest
from app.services.fsrs_service import FSRSService


def make_fsrs() -> FSRSService:
    """Deterministic FSRS service (fuzz off) for reproducible intervals."""
    return FSRSService(
        maximum_interval_days=365, enable_fuzz=False, desired_retention=0.9
    )


def make_review_request(rating: int, **overrides) -> ReviewRequest:
    values = dict(rating=rating, review_duration_ms=1234)
    values.update(overrides)
    return ReviewRequest(**values)


async def seed_cards(
    session_factory,
    deck_id: int,
    *,
    due: int = 0,
    new: int = 0,
    future_days: int = 0,
    learning: int = 0,
) -> list[int]:
    """Create cards with well-defined scheduling shapes; return their ids.

    - due: REVIEW cards with ``next_review_at`` in the past
    - learning: LEARNING cards with ``next_review_at`` in the past
    - future_days: REVIEW cards scheduled in the future (not study-eligible)
    - new: NEW cards (never studied, no schedule)
    """
    now = datetime.now(UTC)
    async with session_factory() as session:
        max_seq = (
            await session.execute(
                select(func.coalesce(func.max(Card.sequence), 0)).where(
                    Card.deck_id == deck_id
                )
            )
        ).scalar_one()
        seq = int(max_seq)

        cards: list[Card] = []

        def make(state: CardState, next_review_at) -> Card:
            nonlocal seq
            seq += 1
            return Card(
                deck_id=deck_id,
                sequence=seq,
                front_content=f"front {seq}",
                back_content="back",
                state=state,
                difficulty=5.0,
                stability=1.0,
                reps=1,
                next_review_at=next_review_at,
            )

        for _ in range(due):
            cards.append(make(CardState.REVIEW, now - timedelta(hours=1)))
        for _ in range(learning):
            cards.append(make(CardState.LEARNING, now - timedelta(minutes=5)))
        for _ in range(future_days):
            cards.append(make(CardState.REVIEW, now + timedelta(days=3)))
        for _ in range(new):
            cards.append(make(CardState.NEW, None))

        session.add_all(cards)
        await session.commit()
        return [card.id for card in cards]
