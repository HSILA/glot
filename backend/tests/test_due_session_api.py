"""Tests for the study-session count endpoints.

Covers the contracts the session page relies on:

- ``/cards/due/summary`` returns authoritative study-eligible counts, is
  scoped by an optional deck_id, and is marked no-store.
- ``/cards/due/batch`` returns one queue batch plus the scope counts from the
  same snapshot (an empty batch with zero counts is the only "caught up"
  signal), and is marked no-store.
- The legacy ``/cards/due`` keeps returning a plain ordered list.

The counting SQL itself is exercised by the PostgreSQL integration tests in
``tests/integration/``; here the service calls are faked to test routing,
validation, response shaping, and header behaviour.
"""

from unittest.mock import AsyncMock, Mock

import pytest
from fastapi import HTTPException, Response

import app.api.v1.cards as cards_api
from app.models import Card, CardState, Deck, User
from app.services.due_cards import StudyScopeCounts

USER = User(id=1, email="user@example.com", password_hash="hash")


def make_card(**overrides) -> Card:
    values = dict(
        id=1,
        deck_id=5,
        sequence=1,
        front_content="Q",
        back_content="A",
        state=CardState.REVIEW,
        difficulty=4.0,
        stability=10.0,
        reps=2,
        lapses=0,
        review_version=1,
    )
    values.update(overrides)
    return Card(**values)


def _one_or_none(value):
    result = Mock()
    result.scalar_one_or_none.return_value = value
    return result


def _patch_counts(monkeypatch, counts: StudyScopeCounts) -> list:
    calls: list[dict] = []

    async def fake(session, *, user_id, as_of, deck_id=None):
        calls.append({"user_id": user_id, "deck_id": deck_id})
        return counts

    monkeypatch.setattr(cards_api, "fetch_study_counts", fake)
    return calls


def _patch_batch(monkeypatch, cards, counts: StudyScopeCounts) -> list:
    calls: list[dict] = []

    async def fake(session, *, user_id, as_of, limit, deck_id=None):
        calls.append(
            {"user_id": user_id, "deck_id": deck_id, "limit": limit}
        )
        return cards, counts

    monkeypatch.setattr(cards_api, "fetch_due_batch", fake)
    return calls


@pytest.mark.asyncio
async def test_summary_returns_counts_and_no_store(monkeypatch) -> None:
    session = AsyncMock()
    _patch_counts(monkeypatch, StudyScopeCounts(15, 5, 20))
    response = Response()

    summary = await cards_api.get_due_summary(
        response, session=session, current_user=USER
    )

    assert summary.scheduled_due_count == 15
    assert summary.new_count == 5
    assert summary.total == 20
    assert summary.deck_id is None
    assert response.headers["cache-control"] == "no-store"


@pytest.mark.asyncio
async def test_summary_is_scoped_and_validated(monkeypatch) -> None:
    deck = Deck(id=9, user_id=1, name="French")
    session = AsyncMock()
    session.execute.side_effect = [_one_or_none(deck)]
    calls = _patch_counts(monkeypatch, StudyScopeCounts(1, 2, 3))
    response = Response()

    summary = await cards_api.get_due_summary(
        response, session=session, current_user=USER, deck_id=9
    )

    assert summary.deck_id == 9
    assert calls == [{"user_id": 1, "deck_id": 9}]

    # Unknown deck -> 404, counts never fetched.
    session.execute.side_effect = [_one_or_none(None)]
    calls.clear()
    with pytest.raises(HTTPException) as exc:
        await cards_api.get_due_summary(
            Response(), session=session, current_user=USER, deck_id=99
        )
    assert exc.value.status_code == 404
    assert calls == []


@pytest.mark.asyncio
async def test_batch_returns_envelope_with_counts(monkeypatch) -> None:
    batch = [
        make_card(id=1, state=CardState.REVIEW),
        make_card(id=2, state=CardState.NEW),
        make_card(id=3, state=CardState.REVIEW),
    ]
    session = AsyncMock()
    calls = _patch_batch(monkeypatch, batch, StudyScopeCounts(2, 1, 3))
    response = Response()

    result = await cards_api.get_due_batch(
        response, session=session, current_user=USER, limit=100, seed=7
    )

    assert len(result.items) == 3
    assert result.summary.total == 3
    assert result.summary.scheduled_due_count == 2
    assert result.summary.new_count == 1
    assert result.limit == 100
    assert response.headers["cache-control"] == "no-store"
    assert calls == [{"user_id": 1, "deck_id": None, "limit": 100}]

    # Same seed on the same set must keep the order stable.
    again = await cards_api.get_due_batch(
        Response(), session=session, current_user=USER, limit=100, seed=7
    )
    assert [c.id for c in again.items] == [c.id for c in result.items]


@pytest.mark.asyncio
async def test_empty_batch_is_the_only_caught_up_signal(monkeypatch) -> None:
    session = AsyncMock()
    _patch_batch(monkeypatch, [], StudyScopeCounts(0, 0, 0))

    result = await cards_api.get_due_batch(
        Response(), session=session, current_user=USER, limit=100, seed=None
    )

    assert result.items == []
    assert result.summary.total == 0


@pytest.mark.asyncio
async def test_batch_validates_deck_scope(monkeypatch) -> None:
    session = AsyncMock()
    session.execute.side_effect = [_one_or_none(None)]
    calls = _patch_batch(monkeypatch, [], StudyScopeCounts(0, 0, 0))

    with pytest.raises(HTTPException) as exc:
        await cards_api.get_due_batch(
            Response(), session=session, current_user=USER, deck_id=99
        )

    assert exc.value.status_code == 404
    assert calls == []


@pytest.mark.asyncio
async def test_legacy_due_returns_plain_ordered_list(monkeypatch) -> None:
    batch = [make_card(id=1), make_card(id=2)]
    session = AsyncMock()
    _patch_batch(monkeypatch, batch, StudyScopeCounts(2, 0, 2))
    response = Response()

    result = await cards_api.get_due_cards(
        response, session=session, current_user=USER, limit=20, seed=11
    )

    assert [c.id for c in result] == [1, 2]
    assert response.headers["cache-control"] == "no-store"
