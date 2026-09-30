"""PostgreSQL integration tests for review idempotency.

Real database behaviour: ON CONFLICT claims, concurrent duplicate submissions,
JSONB snapshot round-trips, version guards, and receipt survival after card
deletion.
"""

import asyncio
from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy import func
from sqlmodel import select

import app.api.v1.cards as cards_api
from app.models import Card, Deck, ReviewLog, ReviewSubmission
from tests.integration.helpers import make_fsrs, make_review_request, seed_cards


async def _review_log_count(session, card_id: int) -> int:
    return (
        await session.execute(
            select(func.count()).select_from(ReviewLog).where(ReviewLog.card_id == card_id)
        )
    ).scalar_one()


async def test_record_then_replay_is_idempotent(session_factory, user_and_deck) -> None:
    user, deck = user_and_deck
    (card_id,) = await seed_cards(session_factory, deck.id, due=1)
    request_id = uuid4()
    fsrs = make_fsrs()

    async with session_factory() as first:
        recorded = await cards_api.review_card(
            card_id=card_id,
            review=make_review_request(3, request_id=request_id, expected_review_version=0),
            session=first,
            current_user=user,
            fsrs=fsrs,
        )

    async with session_factory() as second:
        replayed = await cards_api.review_card(
            card_id=card_id,
            review=make_review_request(3, request_id=request_id, expected_review_version=0),
            session=second,
            current_user=user,
            fsrs=fsrs,
        )

    assert recorded.replayed is False
    assert replayed.replayed is True
    assert replayed.review_id == recorded.review_id

    async with session_factory() as verify:
        assert await _review_log_count(verify, card_id) == 1

        card = (await verify.execute(select(Card).where(Card.id == card_id))).scalar_one()
        assert card.review_version == 1

        receipt = (
            await verify.execute(
                select(ReviewSubmission).where(
                    ReviewSubmission.user_id == user.id,
                    ReviewSubmission.request_id == request_id,
                )
            )
        ).scalar_one()
        assert receipt.fingerprint == cards_api._review_fingerprint(card_id, 3, 1234)
        assert receipt.response_json["review_id"] == recorded.review_id


async def test_concurrent_duplicate_submissions_record_exactly_once(
    session_factory, user_and_deck
) -> None:
    user, deck = user_and_deck
    (card_id,) = await seed_cards(session_factory, deck.id, due=1)
    request_id = uuid4()
    fsrs = make_fsrs()

    async def submit(session):
        return await cards_api.review_card(
            card_id=card_id,
            review=make_review_request(3, request_id=request_id, expected_review_version=0),
            session=session,
            current_user=user,
            fsrs=fsrs,
        )

    async with session_factory() as one, session_factory() as two:
        results = await asyncio.gather(submit(one), submit(two))

    outcomes = sorted(result.replayed for result in results)
    assert outcomes == [False, True]  # one recorded, one answered from the receipt
    assert results[0].review_id == results[1].review_id

    async with session_factory() as verify:
        assert await _review_log_count(verify, card_id) == 1


async def test_key_reuse_with_different_payload_conflicts(
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

    async with session_factory() as session:
        with pytest.raises(HTTPException) as exc:
            await cards_api.review_card(
                card_id=card_id,
                review=make_review_request(4, request_id=request_id),
                session=session,
                current_user=user,
                fsrs=fsrs,
            )
    assert exc.value.status_code == 409

    async with session_factory() as verify:
        assert await _review_log_count(verify, card_id) == 1


async def test_stale_version_rejected_then_fresh_retry_records(
    session_factory, user_and_deck
) -> None:
    user, deck = user_and_deck
    (card_id,) = await seed_cards(session_factory, deck.id, due=1)
    fsrs = make_fsrs()

    async with session_factory() as session:
        await cards_api.review_card(
            card_id=card_id,
            review=make_review_request(3, request_id=uuid4(), expected_review_version=0),
            session=session,
            current_user=user,
            fsrs=fsrs,
        )

    # Another device still holds the version-0 snapshot.
    async with session_factory() as session:
        with pytest.raises(HTTPException) as exc:
            await cards_api.review_card(
                card_id=card_id,
                review=make_review_request(2, request_id=uuid4(), expected_review_version=0),
                session=session,
                current_user=user,
                fsrs=fsrs,
            )
    assert exc.value.status_code == 409
    assert exc.value.detail["code"] == "stale_review_version"
    assert exc.value.detail["card"]["review_version"] == 1

    # After resyncing, a fresh submission with the current version succeeds.
    async with session_factory() as session:
        ok = await cards_api.review_card(
            card_id=card_id,
            review=make_review_request(2, request_id=uuid4(), expected_review_version=1),
            session=session,
            current_user=user,
            fsrs=fsrs,
        )
    assert ok.replayed is False
    assert ok.card.review_version == 2

    async with session_factory() as verify:
        assert await _review_log_count(verify, card_id) == 2


async def test_receipt_survives_card_deletion(session_factory, user_and_deck) -> None:
    user, deck = user_and_deck
    (card_id,) = await seed_cards(session_factory, deck.id, due=1)
    request_id = uuid4()
    fsrs = make_fsrs()

    async with session_factory() as session:
        recorded = await cards_api.review_card(
            card_id=card_id,
            review=make_review_request(3, request_id=request_id),
            session=session,
            current_user=user,
            fsrs=fsrs,
        )

        card = (await session.execute(select(Card).where(Card.id == card_id))).scalar_one()
        await session.delete(card)
        await session.commit()

    # A late duplicate of the deleted card's review is still deduplicated.
    async with session_factory() as session:
        replayed = await cards_api.review_card(
            card_id=card_id,
            review=make_review_request(3, request_id=request_id),
            session=session,
            current_user=user,
            fsrs=fsrs,
        )

    assert replayed.replayed is True
    assert replayed.review_id == recorded.review_id


async def test_scope_summary_is_deck_scoped(session_factory, user_and_deck) -> None:
    user, deck = user_and_deck
    await seed_cards(session_factory, deck.id, due=2)
    fsrs = make_fsrs()

    async with session_factory() as session:
        second_deck = Deck(user_id=user.id, name="Second")
        session.add(second_deck)
        await session.commit()
        await session.refresh(second_deck)
    await seed_cards(session_factory, second_deck.id, due=3)

    async with session_factory() as session:
        cards, _ = await fetch_batch(session, user.id, deck.id)
        response = await cards_api.review_card(
            card_id=cards[0].id,
            review=make_review_request(3, request_id=uuid4(), scope_deck_id=deck.id),
            session=session,
            current_user=user,
            fsrs=fsrs,
        )

    assert response.summary is not None
    assert response.summary.deck_id == deck.id
    assert response.summary.total == 1  # only this deck's remaining card


async def fetch_batch(session, user_id: int, deck_id: int):
    from datetime import UTC, datetime

    from app.services.due_cards import fetch_due_batch

    return await fetch_due_batch(
        session, user_id=user_id, as_of=datetime.now(UTC), limit=100, deck_id=deck_id
    )
