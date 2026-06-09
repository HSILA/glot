from datetime import UTC, datetime, timedelta

from app.models.card import Card, CardState
from app.services.fsrs_service import AGAIN_RETRY_DELAY, FSRSService


def make_card(**overrides) -> Card:
    values = {
        "sequence": 1,
        "deck_id": 1,
        "front_content": "bonjour",
        "back_content": "hello",
    }
    values.update(overrides)
    return Card(**values)


def test_again_keeps_card_due_immediately_today():
    service = FSRSService()
    card = make_card(state=CardState.REVIEW, stability=2.0, difficulty=5.0, reps=3)

    before = datetime.now(UTC)
    updated, _scheduled_days, _elapsed_days = service.apply_review(card, rating=1)
    after = datetime.now(UTC)

    assert updated.state == CardState.RELEARNING
    assert updated.lapses == 1
    assert updated.reps == 4
    assert updated.last_review_at is not None
    assert updated.next_review_at is not None
    assert before <= updated.next_review_at <= after + AGAIN_RETRY_DELAY


def test_passing_rating_keeps_day_based_schedule():
    service = FSRSService()
    card = make_card(state=CardState.REVIEW, stability=2.0, difficulty=5.0, reps=3)

    updated, _scheduled_days, _elapsed_days = service.apply_review(card, rating=3)

    assert updated.state == CardState.REVIEW
    assert updated.last_review_at is not None
    assert updated.next_review_at is not None
    assert updated.next_review_at - updated.last_review_at >= timedelta(days=1)


def test_passing_after_again_graduates_out_of_immediate_retry():
    service = FSRSService()
    card = make_card(state=CardState.REVIEW, stability=2.0, difficulty=5.0, reps=3)

    updated, _scheduled_days, _elapsed_days = service.apply_review(card, rating=1)
    assert updated.state == CardState.RELEARNING
    assert updated.next_review_at is not None
    assert updated.last_review_at is not None
    assert updated.next_review_at == updated.last_review_at + AGAIN_RETRY_DELAY

    updated, _scheduled_days, _elapsed_days = service.apply_review(updated, rating=3)

    assert updated.state == CardState.REVIEW
    assert updated.next_review_at is not None
    assert updated.last_review_at is not None
    assert updated.next_review_at - updated.last_review_at >= timedelta(days=1)
