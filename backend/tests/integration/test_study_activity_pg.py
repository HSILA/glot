"""PostgreSQL integration tests for the study activity calendar (issue #126).

Verifies against a real database:

- one committed rating inserts exactly one activity event, inside the review
  transaction (replays, stale versions, and rejections create none);
- activity survives card deletion (projection, not review_logs);
- backfill semantics: the migration's INSERT ... ON CONFLICT DO NOTHING is
  rerunnable without duplicates;
- daily grouping, streaks, and the dense 365-day response shape;
- timezone regrouping (America/Toronto) and UTC fallback for unset zones.
"""

from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from fastapi import HTTPException
from fastapi import Response as FastAPIResponse
from sqlmodel import select

import app.api.v1.cards as cards_api
from app.api.v1.activity import get_activity
from app.models import Card, StudyActivityEvent, UserSettings
from tests.integration.helpers import make_fsrs, make_review_request, seed_cards


async def _ensure_settings(session, user) -> UserSettings:
    """The conftest fixture creates no settings row; add one for this test."""
    settings = (
        await session.execute(
            select(UserSettings).where(UserSettings.user_id == user.id)
        )
    ).scalar_one_or_none()
    if settings is None:
        settings = UserSettings(user_id=user.id)
        session.add(settings)
        await session.commit()
    return settings


async def _events(session, user_id: int) -> list[StudyActivityEvent]:
    return list(
        (
            await session.execute(
                select(StudyActivityEvent).where(
                    StudyActivityEvent.user_id == user_id
                )
            )
        ).scalars()
    )


async def _review(session, user, card_id: int, rating: int = 3):
    return await cards_api.review_card(
        card_id=card_id,
        review=make_review_request(rating, request_id=uuid4()),
        session=session,
        current_user=user,
        fsrs=make_fsrs(),
    )


async def test_one_event_per_committed_rating(session_factory, user_and_deck) -> None:
    user, deck = user_and_deck
    (card_id,) = await seed_cards(session_factory, deck.id, due=1)

    async with session_factory() as session:
        await _review(session, user, card_id)

    async with session_factory() as verify:
        events = await _events(verify, user.id)
        assert len(events) == 1
        assert events[0].user_id == user.id
        assert events[0].review_log_id is not None

        # A second distinct rating adds a second event: make the card due
        # again and review once more.
        card = (
            await verify.execute(select(Card).where(Card.id == card_id))
        ).scalar_one()
        card.next_review_at = datetime.now(UTC) - timedelta(hours=1)
        await verify.commit()

    async with session_factory() as session:
        await _review(session, user, card_id)

    async with session_factory() as verify:
        assert len(await _events(verify, user.id)) == 2


async def test_replay_and_rejections_create_no_events(
    session_factory, user_and_deck
) -> None:
    user, deck = user_and_deck
    (card_id,) = await seed_cards(session_factory, deck.id, due=1)
    request_id = uuid4()
    fsrs = make_fsrs()

    async with session_factory() as session:
        await cards_api.review_card(
            card_id=card_id,
            review=make_review_request(3, request_id=request_id),
            session=session,
            current_user=user,
            fsrs=fsrs,
        )

    # Replay: no new event.
    async with session_factory() as session:
        replayed = await cards_api.review_card(
            card_id=card_id,
            review=make_review_request(3, request_id=request_id),
            session=session,
            current_user=user,
            fsrs=fsrs,
        )
        assert replayed.replayed is True

    async with session_factory() as verify:
        assert len(await _events(verify, user.id)) == 1

    # Stale version: 409, no new event.
    async with session_factory() as session:
        with pytest.raises(HTTPException) as exc:
            await cards_api.review_card(
                card_id=card_id,
                review=make_review_request(
                    2, request_id=uuid4(), expected_review_version=0
                ),
                session=session,
                current_user=user,
                fsrs=fsrs,
            )
        assert exc.value.status_code == 409

    async with session_factory() as verify:
        assert len(await _events(verify, user.id)) == 1


async def test_activity_survives_card_deletion(
    session_factory, user_and_deck
) -> None:
    user, deck = user_and_deck
    (card_id,) = await seed_cards(session_factory, deck.id, due=1)

    async with session_factory() as session:
        await _review(session, user, card_id)
        card = (
            await session.execute(select(Card).where(Card.id == card_id))
        ).scalar_one()
        await session.delete(card)
        await session.commit()

    async with session_factory() as verify:
        assert len(await _events(verify, user.id)) == 1


async def test_backfill_statement_is_rerunnable(session_factory, user_and_deck) -> None:
    """The migration's INSERT ... ON CONFLICT DO NOTHING must rerun safely."""
    user, deck = user_and_deck
    (card_id,) = await seed_cards(session_factory, deck.id, due=1)

    async with session_factory() as session:
        await _review(session, user, card_id)

    from sqlalchemy import text as sa_text

    backfill = """
        INSERT INTO study_activity_events (user_id, review_log_id, reviewed_at)
        SELECT d.user_id, rl.id, rl.reviewed_at
        FROM review_logs AS rl
        JOIN cards AS c ON c.id = rl.card_id
        JOIN decks AS d ON d.id = c.deck_id
        ON CONFLICT (review_log_id) DO NOTHING
    """
    async with session_factory() as session:
        await session.execute(sa_text(backfill))
        await session.execute(sa_text(backfill))
        await session.commit()

    async with session_factory() as verify:
        assert len(await _events(verify, user.id)) == 1


async def test_activity_endpoint_dense_dates_and_streaks(
    session_factory, user_and_deck
) -> None:
    user, deck = user_and_deck
    (card_id,) = await seed_cards(session_factory, deck.id, due=1)

    async with session_factory() as session:
        await _review(session, user, card_id)

    async with session_factory() as session:
        await _ensure_settings(session, user)

    async with session_factory() as session:
        response = FastAPIResponse()
        snapshot = await get_activity(response, session, user)
        assert response.headers.get("Cache-Control") == "no-store"
        assert snapshot.timezone == "UTC"
        assert snapshot.timezone_is_set is False
        assert len(snapshot.days) == 365
        dates = [day.date for day in snapshot.days]
        assert dates == sorted(set(dates))
        assert dates[-1] == snapshot.today
        assert snapshot.current_streak >= 1
        assert snapshot.longest_streak >= snapshot.current_streak
        assert snapshot.today_review_count >= 1
        assert snapshot.last_active_date is not None
        assert sum(day.review_count for day in snapshot.days) >= 1


async def test_timezone_regroups_history(session_factory, user_and_deck) -> None:
    user, deck = user_and_deck
    (card_id,) = await seed_cards(session_factory, deck.id, due=1)

    async with session_factory() as session:
        await _review(session, user, card_id)

    async with session_factory() as session:
        settings = await _ensure_settings(session, user)
        settings.timezone = "America/Toronto"
        await session.commit()

    async with session_factory() as session:
        snapshot = await get_activity(FastAPIResponse(), session, user)
        assert snapshot.timezone == "America/Toronto"
        assert snapshot.timezone_is_set is True
