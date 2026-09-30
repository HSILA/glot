"""PostgreSQL integration tests for study counts and batch continuation.

Verifies against a real database that:

- the scope counts the session header shows match the per-deck counters the
  dashboard renders (one formula, two surfaces);
- a batch and its counts are one consistent snapshot, so continuation can
  trust an empty batch;
- the full session loop (keep fetching until empty) never reports "nothing
  left" while cards are due.
"""

from datetime import UTC, datetime
from uuid import uuid4

from fastapi import Response
from sqlmodel import select

import app.api.v1.cards as cards_api
from app.api.v1.decks import _deck_stats_subquery
from app.models import Card, Deck
from app.services.due_cards import fetch_due_batch, fetch_study_counts
from tests.integration.helpers import make_fsrs, make_review_request, seed_cards


async def test_study_counts_match_dashboard_deck_counters(
    session_factory, user_and_deck
) -> None:
    user, deck = user_and_deck
    await seed_cards(session_factory, deck.id, due=3, new=2, future_days=4, learning=1)

    async with session_factory() as session:
        counts = await fetch_study_counts(
            session, user_id=user.id, as_of=datetime.now(UTC), deck_id=deck.id
        )
        assert counts.scheduled_due_count == 4  # 3 due + 1 learning
        assert counts.new_count == 2
        assert counts.total == 6

        global_counts = await fetch_study_counts(
            session, user_id=user.id, as_of=datetime.now(UTC)
        )
        assert global_counts == counts

        # The dashboard's deck chips must agree with the session counts.
        stats_subq = _deck_stats_subquery(
            now=datetime.now(UTC), user_id=user.id, deck_id=deck.id
        )
        row = (
            await session.execute(select(stats_subq.c.due_count, stats_subq.c.new_count))
        ).one()
        assert row[0] == counts.scheduled_due_count
        assert row[1] == counts.new_count


async def test_deck_scope_isolates_counts(session_factory, user_and_deck) -> None:
    user, deck = user_and_deck
    async with session_factory() as session:
        other = Deck(user_id=user.id, name="Other deck")
        session.add(other)
        await session.commit()
        await session.refresh(other)

    await seed_cards(session_factory, deck.id, due=2)
    await seed_cards(session_factory, other.id, due=1, new=3)

    async with session_factory() as session:
        deck_counts = await fetch_study_counts(
            session, user_id=user.id, as_of=datetime.now(UTC), deck_id=deck.id
        )
        global_counts = await fetch_study_counts(
            session, user_id=user.id, as_of=datetime.now(UTC)
        )

    assert (deck_counts.scheduled_due_count, deck_counts.new_count) == (2, 0)
    assert (global_counts.scheduled_due_count, global_counts.new_count) == (3, 3)
    assert global_counts.total == 6


async def test_batch_and_counts_are_one_snapshot(session_factory, user_and_deck) -> None:
    user, deck = user_and_deck
    await seed_cards(session_factory, deck.id, due=150, new=10)

    async with session_factory() as session:
        cards, counts = await fetch_due_batch(
            session,
            user_id=user.id,
            as_of=datetime.now(UTC),
            limit=100,
            deck_id=deck.id,
        )
        assert len(cards) == 100
        assert counts.total == 160  # counts describe the whole scope, not the batch


async def test_batch_endpoint_is_deterministic_per_seed(
    session_factory, user_and_deck
) -> None:
    user, deck = user_and_deck
    await seed_cards(session_factory, deck.id, due=120, new=10)

    async with session_factory() as session:
        first = await cards_api.get_due_batch(
            Response(), session=session, current_user=user, limit=100, deck_id=deck.id, seed=42
        )
        repeat = await cards_api.get_due_batch(
            Response(), session=session, current_user=user, limit=100, deck_id=deck.id, seed=42
        )
        other_seed = await cards_api.get_due_batch(
            Response(), session=session, current_user=user, limit=100, deck_id=deck.id, seed=43
        )

    assert len(first.items) == 100
    assert first.summary.total == 130
    assert [card.id for card in repeat.items] == [card.id for card in first.items]
    assert {card.id for card in other_seed.items} == {card.id for card in first.items}


async def test_session_loop_continues_past_the_first_batch(
    session_factory, user_and_deck
) -> None:
    """The user's scenario: >100 due cards must never produce a false 'caught up'."""
    user, deck = user_and_deck
    await seed_cards(session_factory, deck.id, due=105)
    fsrs = make_fsrs()

    async with session_factory() as session:
        first = await cards_api.get_due_batch(
            Response(), session=session, current_user=user, limit=100, deck_id=deck.id, seed=7
        )
        assert len(first.items) == 100
        assert first.summary.total == 105

        for card in first.items:
            response = await cards_api.review_card(
                card_id=card.id,
                review=make_review_request(
                    3,
                    request_id=uuid4(),
                    expected_review_version=card.review_version,
                    scope_deck_id=deck.id,
                ),
                session=session,
                current_user=user,
                fsrs=fsrs,
            )
            assert response.replayed is False

        assert response.summary is not None
        assert response.summary.total == 5

        second = await cards_api.get_due_batch(
            Response(), session=session, current_user=user, limit=100, deck_id=deck.id, seed=7
        )
        assert len(second.items) == 5
        assert second.summary.total == 5

        for card in second.items:
            await cards_api.review_card(
                card_id=card.id,
                review=make_review_request(
                    3,
                    request_id=uuid4(),
                    expected_review_version=card.review_version,
                    scope_deck_id=deck.id,
                ),
                session=session,
                current_user=user,
                fsrs=fsrs,
            )

        final = await cards_api.get_due_batch(
            Response(), session=session, current_user=user, limit=100, deck_id=deck.id, seed=7
        )

    assert final.items == []
    assert final.summary.total == 0


async def test_again_keeps_card_due_but_passing_rating_clears_it(
    session_factory, user_and_deck
) -> None:
    user, deck = user_and_deck
    (card_id,) = await seed_cards(session_factory, deck.id, due=1)
    fsrs = make_fsrs()

    async with session_factory() as session:
        again = await cards_api.review_card(
            card_id=card_id,
            review=make_review_request(
                1,
                request_id=uuid4(),
                expected_review_version=0,
                scope_deck_id=deck.id,
            ),
            session=session,
            current_user=user,
            fsrs=fsrs,
        )
        assert again.summary is not None
        assert again.summary.total == 1  # still due: the user must pass it
        assert again.card.review_version == 1

        passed = await cards_api.review_card(
            card_id=card_id,
            review=make_review_request(
                3,
                request_id=uuid4(),
                expected_review_version=1,
                scope_deck_id=deck.id,
            ),
            session=session,
            current_user=user,
            fsrs=fsrs,
        )
        assert passed.summary is not None
        assert passed.summary.total == 0

    async with session_factory() as verify:
        fresh = (
            await verify.execute(select(Card).where(Card.id == card_id))
        ).scalar_one()
        assert fresh.review_version == 2
        lapses = fresh.lapses
        assert lapses == 1  # the Again was recorded
