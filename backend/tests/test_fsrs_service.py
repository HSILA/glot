from datetime import UTC, datetime, timedelta
from unittest.mock import Mock

import pytest

from app.models.card import Card, CardState
from app.services.fsrs_service import AGAIN_RETRY_DELAY, FSRSService, _round_days


def make_card(**overrides) -> Card:
    values = {
        "sequence": 1,
        "deck_id": 1,
        "front_content": "bonjour",
        "back_content": "hello",
    }
    values.update(overrides)
    return Card(**values)


def make_mature_card(card_id: int = 42) -> Card:
    return make_card(
        id=card_id,
        state=CardState.REVIEW,
        stability=100.0,
        difficulty=5.0,
        reps=10,
        last_review_at=datetime.now(UTC) - timedelta(days=100),
        next_review_at=datetime.now(UTC) - timedelta(days=1),
    )


@pytest.mark.parametrize(("value", "expected"), [(2.5, 3), (4.5, 5), (4.49, 4)])
def test_interval_rounding_matches_fsrs_positive_half_up(value, expected):
    assert _round_days(value) == expected


def test_again_keeps_card_due_immediately_today():
    service = FSRSService(maximum_interval_days=90, enable_fuzz=False)
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
    service = FSRSService(maximum_interval_days=90, enable_fuzz=False)
    card = make_card(state=CardState.REVIEW, stability=2.0, difficulty=5.0, reps=3)

    updated, _scheduled_days, _elapsed_days = service.apply_review(card, rating=3)

    assert updated.state == CardState.REVIEW
    assert updated.last_review_at is not None
    assert updated.next_review_at is not None
    assert updated.next_review_at - updated.last_review_at >= timedelta(days=1)


def test_passing_after_again_graduates_out_of_immediate_retry():
    service = FSRSService(maximum_interval_days=90, enable_fuzz=False)
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


@pytest.mark.parametrize(
    ("rating", "preview_field"),
    [(2, "hard"), (3, "good"), (4, "easy")],
)
def test_preview_matches_persisted_capped_interval(rating, preview_field):
    service = FSRSService(maximum_interval_days=90, enable_fuzz=True)
    card = make_mature_card()
    preview = service.get_next_states_response(card)

    updated, _scheduled_days, _elapsed_days = service.apply_review(card, rating)
    assert updated.next_review_at is not None
    assert updated.last_review_at is not None
    persisted_days = (updated.next_review_at - updated.last_review_at).days
    preview_days = getattr(preview, preview_field).interval_days

    assert persisted_days == preview_days
    assert persisted_days <= 90


def test_again_preview_matches_immediate_persisted_retry():
    service = FSRSService(maximum_interval_days=90, enable_fuzz=True)
    card = make_mature_card()

    preview = service.get_next_states_response(card)
    updated, _scheduled_days, _elapsed_days = service.apply_review(card, rating=1)

    assert preview.again.interval_days == 0
    assert updated.next_review_at == updated.last_review_at


def test_fuzz_preview_is_stable_for_unchanged_card():
    service = FSRSService(maximum_interval_days=90, enable_fuzz=True)
    card = make_mature_card()

    first = service.get_next_states_response(card)
    second = service.get_next_states_response(card)

    assert first == second


def test_fuzz_spreads_equivalent_cards_while_disabled_mode_does_not():
    fuzzed = FSRSService(maximum_interval_days=90, enable_fuzz=True)
    exact = FSRSService(maximum_interval_days=90, enable_fuzz=False)
    cards = [make_mature_card(card_id) for card_id in range(1, 25)]

    fuzzed_intervals = {
        fuzzed.get_next_states_response(card).good.interval_days for card in cards
    }
    exact_intervals = {
        exact.get_next_states_response(card).good.interval_days for card in cards
    }

    assert len(fuzzed_intervals) > 1
    assert len(exact_intervals) == 1


def test_fuzz_never_exceeds_maximum_interval():
    service = FSRSService(maximum_interval_days=5, enable_fuzz=True)

    for card_id in range(1, 25):
        preview = service.get_next_states_response(make_mature_card(card_id))
        assert preview.hard.interval_days <= 5
        assert preview.good.interval_days <= 5
        assert preview.easy.interval_days <= 5


@pytest.mark.parametrize("fraction", [0.0, 0.5, 0.999999])
def test_fuzz_range_is_based_on_capped_interval(fraction):
    service = FSRSService(maximum_interval_days=90, enable_fuzz=True)

    interval = service._resolve_interval(
        10_000,
        elapsed_days=0,
        fraction=fraction,
    )

    assert 84 <= interval <= 90


def test_fuzz_preserves_rating_interval_order_under_cap():
    service = FSRSService(maximum_interval_days=90, enable_fuzz=True)

    for card_id in range(1, 101):
        preview = service.get_next_states_response(make_mature_card(card_id))
        assert preview.hard.interval_days <= preview.good.interval_days
        assert preview.good.interval_days <= preview.easy.interval_days


def test_fuzz_lower_bound_respects_elapsed_days():
    service = FSRSService(maximum_interval_days=90, enable_fuzz=True)

    minimum, maximum = service._fuzz_bounds(
        interval=5,
        elapsed_days=4,
        maximum_interval=90,
    )

    assert minimum >= 5
    assert minimum <= maximum


def test_preview_uses_one_elapsed_days_snapshot():
    service = FSRSService(maximum_interval_days=90, enable_fuzz=True)
    service.calculate_elapsed_days = Mock(return_value=100)

    service.get_next_states_response(make_mature_card())

    service.calculate_elapsed_days.assert_called_once()


def test_apply_review_uses_one_elapsed_days_snapshot():
    service = FSRSService(maximum_interval_days=90, enable_fuzz=True)
    service.calculate_elapsed_days = Mock(return_value=100)

    service.apply_review(make_mature_card(), rating=3)

    service.calculate_elapsed_days.assert_called_once()
