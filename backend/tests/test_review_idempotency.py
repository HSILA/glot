"""Tests for idempotent review submissions (request_id receipts + version guard).

These exercise the review endpoint's branching with a mocked session: legacy
requests keep the old path, new requests claim a receipt, replays are answered
from the stored snapshot, and both misuse (key reuse) and staleness (version
mismatch) are rejected with 409. Real SQL behaviours (conflict handling, row
locking, snapshot round-trips) are covered by the PostgreSQL integration tests
in ``tests/integration/``.
"""

from datetime import datetime
from unittest.mock import AsyncMock, Mock
from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy import Insert, Update

import app.api.v1.cards as cards_api
from app.models import Card, CardState, ReviewSubmission, User
from app.schemas.card import CardRead, NextStatesResponse, ReviewRequest, ReviewResponse
from app.services.due_cards import StudyScopeCounts
from app.services.fsrs_service import FSRSService

USER = User(id=1, email="user@example.com", password_hash="hash")


def make_fsrs() -> FSRSService:
    return FSRSService(
        maximum_interval_days=365, enable_fuzz=False, desired_retention=0.9
    )


def make_card(**overrides) -> Card:
    values = dict(
        id=7,
        deck_id=1,
        sequence=1,
        front_content="chat",
        back_content="cat",
        state=CardState.NEW,
        difficulty=5.0,
        stability=0.0,
        reps=0,
        lapses=0,
        review_version=0,
    )
    values.update(overrides)
    return Card(**values)


def make_next_states() -> NextStatesResponse:
    info = {"interval_days": 1, "new_difficulty": 5.0, "new_stability": 1.0}
    return NextStatesResponse(again=info, hard=info, good=info, easy=info)


def make_card_read_dict(**overrides) -> dict:
    values = dict(
        id=7,
        sequence=1,
        front_content="chat",
        back_content="cat",
        meta_data={},
        tags=[],
        deck_id=1,
        difficulty=5.0,
        stability=1.0,
        state="review",
        reps=1,
        lapses=0,
        review_version=1,
        last_review_at="2026-09-01T00:00:00Z",
        next_review_at="2026-09-10T00:00:00Z",
        created_at="2025-01-01T00:00:00Z",
        updated_at="2026-09-01T00:00:00Z",
    )
    values.update(overrides)
    return values


def _result(**methods):
    result = Mock()
    for name, value in methods.items():
        getattr(result, name).return_value = value
    return result


def _one_or_none(value):
    return _result(scalar_one_or_none=value)


def _patch_summary(monkeypatch, counts: StudyScopeCounts) -> list:
    """Replace fetch_study_counts; record the scopes it was asked for."""
    calls: list[dict] = []

    async def fake(session, *, user_id, as_of, deck_id=None):
        calls.append({"user_id": user_id, "deck_id": deck_id})
        return counts

    monkeypatch.setattr(cards_api, "fetch_study_counts", fake)
    return calls


@pytest.mark.asyncio
async def test_legacy_submission_without_request_id_still_records() -> None:
    card = make_card(review_version=3)
    session = AsyncMock()
    session.add = Mock()
    session.execute.side_effect = [_one_or_none(card)]

    response = await cards_api.review_card(
        card_id=7,
        review=ReviewRequest(rating=3, review_duration_ms=1000),
        session=session,
        current_user=USER,
        fsrs=make_fsrs(),
    )

    assert response.replayed is False
    assert response.request_id is None
    assert response.summary is None
    assert card.review_version == 4
    log = session.add.call_args[0][0]
    assert log.card_id == 7
    assert log.rating == 3
    session.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_new_submission_records_once_and_completes_receipt(
    monkeypatch,
) -> None:
    request_id = uuid4()
    card = make_card(review_version=0)

    session = AsyncMock()
    session.add = Mock()
    session.flush = AsyncMock(side_effect=lambda: setattr(session.add.call_args[0][0], "id", 99))
    session.execute.side_effect = [
        _result(scalar_one_or_none=123),  # claim wins
        _one_or_none(card),  # card load
        Mock(),  # receipt completion update
    ]
    calls = _patch_summary(monkeypatch, StudyScopeCounts(5, 3, 8))

    response = await cards_api.review_card(
        card_id=7,
        review=ReviewRequest(
            rating=3,
            review_duration_ms=1000,
            request_id=request_id,
            expected_review_version=0,
        ),
        session=session,
        current_user=USER,
        fsrs=make_fsrs(),
    )

    assert response.replayed is False
    assert response.request_id == request_id
    assert response.review_id == 99
    assert response.summary is not None
    assert response.summary.total == 8
    assert card.review_version == 1
    assert calls == [{"user_id": 1, "deck_id": None}]

    executed = [call.args[0] for call in session.execute.await_args_list]
    assert len(executed) == 3
    assert isinstance(executed[0], Insert)  # receipt claim
    assert isinstance(executed[2], Update)  # receipt completion
    session.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_replay_returns_stored_snapshot_without_recording(monkeypatch) -> None:
    request_id = uuid4()
    stored = ReviewResponse(
        card=CardRead.model_validate(make_card_read_dict(review_version=1)),
        next_states=make_next_states(),
        message="Review recorded: rating=3",
        request_id=request_id,
        review_id=55,
        replayed=False,
        summary=None,
    )
    receipt = ReviewSubmission(
        user_id=1,
        request_id=request_id,
        fingerprint=cards_api._review_fingerprint(7, 3, 1000),
        card_id=7,
        response_json=stored.model_dump(mode="json"),
    )

    session = AsyncMock()
    session.execute.side_effect = [
        _result(scalar_one_or_none=None),  # claim conflict
        _one_or_none(receipt),  # stored receipt found
    ]
    _patch_summary(monkeypatch, StudyScopeCounts(2, 2, 4))

    response = await cards_api.review_card(
        card_id=7,
        review=ReviewRequest(rating=3, review_duration_ms=1000, request_id=request_id),
        session=session,
        current_user=USER,
        fsrs=make_fsrs(),
    )

    assert response.replayed is True
    assert response.review_id == 55
    assert response.request_id == request_id
    assert response.summary is not None
    assert response.summary.total == 4
    session.commit.assert_not_awaited()
    assert len(session.execute.await_args_list) == 2


@pytest.mark.asyncio
async def test_reused_request_id_with_different_payload_is_rejected() -> None:
    request_id = uuid4()
    receipt = ReviewSubmission(
        user_id=1,
        request_id=request_id,
        fingerprint="0" * 64,  # does not match the payload below
        card_id=7,
        response_json={},
    )

    session = AsyncMock()
    session.execute.side_effect = [
        _result(scalar_one_or_none=None),
        _one_or_none(receipt),
    ]

    with pytest.raises(HTTPException) as exc:
        await cards_api.review_card(
            card_id=7,
            review=ReviewRequest(rating=3, request_id=request_id),
            session=session,
            current_user=USER,
            fsrs=make_fsrs(),
        )

    assert exc.value.status_code == 409
    assert "already used" in exc.value.detail


@pytest.mark.asyncio
async def test_stale_expected_version_is_rejected_with_fresh_state(
    monkeypatch,
) -> None:
    card = make_card(review_version=2)

    session = AsyncMock()
    session.execute.side_effect = [
        _result(scalar_one_or_none=42),  # claim wins
        _one_or_none(card),  # card load
    ]
    _patch_summary(monkeypatch, StudyScopeCounts(5, 3, 8))

    with pytest.raises(HTTPException) as exc:
        await cards_api.review_card(
            card_id=7,
            review=ReviewRequest(
                rating=3, request_id=uuid4(), expected_review_version=1
            ),
            session=session,
            current_user=USER,
            fsrs=make_fsrs(),
        )

    assert exc.value.status_code == 409
    detail = exc.value.detail
    assert detail["code"] == "stale_review_version"
    assert detail["card"]["review_version"] == 2
    assert detail["summary"]["total"] == 8
    assert card.review_version == 2  # not bumped
    session.commit.assert_not_awaited()


@pytest.mark.asyncio
async def test_unresolvable_duplicate_asks_for_retry() -> None:
    session = AsyncMock()
    session.execute.side_effect = [
        _result(scalar_one_or_none=None),  # claim conflict
        _result(scalar_one_or_none=None),  # receipt not visible
    ]

    with pytest.raises(HTTPException) as exc:
        await cards_api.review_card(
            card_id=7,
            review=ReviewRequest(rating=3, request_id=uuid4()),
            session=session,
            current_user=USER,
            fsrs=make_fsrs(),
        )

    assert exc.value.status_code == 409
    assert "retry" in exc.value.detail.lower()


@pytest.mark.asyncio
async def test_missing_scope_deck_is_rejected() -> None:
    session = AsyncMock()
    session.execute.side_effect = [
        _result(scalar_one_or_none=42),  # claim wins
        _result(scalar_one_or_none=None),  # scoped deck not found
    ]

    with pytest.raises(HTTPException) as exc:
        await cards_api.review_card(
            card_id=7,
            review=ReviewRequest(rating=3, request_id=uuid4(), scope_deck_id=99),
            session=session,
            current_user=USER,
            fsrs=make_fsrs(),
        )

    assert exc.value.status_code == 404


def test_review_fingerprint_guards_payload_identity() -> None:
    base = cards_api._review_fingerprint(7, 3, 1000)
    assert base == cards_api._review_fingerprint(7, 3, 1000)
    assert base != cards_api._review_fingerprint(7, 4, 1000)
    assert base != cards_api._review_fingerprint(8, 3, 1000)
    assert base != cards_api._review_fingerprint(7, 3, None)
    assert base != cards_api._review_fingerprint(7, 3, 0)


def test_due_summary_read_maps_counts() -> None:
    as_of = datetime(2026, 9, 29, 12, 0, 0)
    summary = cards_api._due_summary_read(
        StudyScopeCounts(scheduled_due_count=5, new_count=3, total=8),
        as_of=as_of,
        deck_id=9,
    )
    assert summary.scheduled_due_count == 5
    assert summary.new_count == 3
    assert summary.total == 8
    assert summary.deck_id == 9
    assert summary.as_of == as_of
