"""Unit tests for review-queue ordering (app/services/review_queue.py).

These cover the pure ordering helpers without a DB: bucket priority,
new-card interleaving, non-fixed ordering, and seed stability.
"""

from dataclasses import dataclass

from app.models.card import CardState
from app.services.review_queue import interleave, order_due_cards


@dataclass
class FakeCard:
    """Minimal stand-in: order_due_cards only reads ``state`` (and we add an id
    so test assertions can compare ordering)."""

    id: int
    state: CardState


def _ids(cards):
    return [c.id for c in cards]


def _make(n, state, start=0):
    return [FakeCard(id=start + i, state=state) for i in range(n)]


# --------------------------------------------------------------------------- #
# interleave
# --------------------------------------------------------------------------- #


def test_interleave_empty_secondary_returns_primary_copy():
    primary = [1, 2, 3]
    result = interleave(primary, [])
    assert result == [1, 2, 3]
    assert result is not primary  # a copy, not the original list


def test_interleave_empty_primary_returns_secondary_copy():
    assert interleave([], ["a", "b"]) == ["a", "b"]


def test_interleave_spreads_secondary_without_front_or_back_loading():
    primary = [f"r{i}" for i in range(8)]
    secondary = ["n0", "n1"]

    result = interleave(primary, secondary)

    # No cards lost or duplicated.
    assert sorted(result) == sorted(primary + secondary)
    positions = [result.index(s) for s in secondary]
    # Not all secondary clustered at the very front...
    assert not all(p < len(secondary) for p in positions)
    # ...nor at the very back.
    assert not all(p >= len(primary) for p in positions)
    # Relative order within each input is preserved.
    assert result.index("n0") < result.index("n1")


# --------------------------------------------------------------------------- #
# order_due_cards — bucket priority
# --------------------------------------------------------------------------- #


def test_learning_and_relearning_come_before_review_and_new():
    cards = (
        _make(2, CardState.REVIEW, start=0)
        + _make(2, CardState.NEW, start=10)
        + _make(1, CardState.LEARNING, start=20)
        + _make(1, CardState.RELEARNING, start=30)
    )

    result = order_due_cards(cards, seed=7)

    learning_states = {CardState.LEARNING, CardState.RELEARNING}
    state_by_id = {c.id: c.state for c in cards}
    ordered_states = [state_by_id[i] for i in _ids(result)]
    last_learning = max(
        i for i, s in enumerate(ordered_states) if s in learning_states
    )
    first_other = min(
        i for i, s in enumerate(ordered_states) if s not in learning_states
    )
    assert last_learning < first_other


def test_new_cards_interleaved_among_reviews_not_back_loaded():
    cards = _make(8, CardState.REVIEW, start=0) + _make(2, CardState.NEW, start=100)

    result = order_due_cards(cards, seed=3)
    new_ids = {c.id for c in cards if c.state == CardState.NEW}
    positions = [i for i, c in enumerate(result) if c.id in new_ids]

    # New cards must not all sit at the front or all at the back.
    assert not all(p < len(new_ids) for p in positions)
    assert not all(p >= len(cards) - len(new_ids) for p in positions)


# --------------------------------------------------------------------------- #
# order_due_cards — randomness and seed stability
# --------------------------------------------------------------------------- #


def test_same_seed_yields_stable_order():
    cards = _make(12, CardState.REVIEW)
    assert _ids(order_due_cards(cards, seed=42)) == _ids(order_due_cards(cards, seed=42))


def test_different_seeds_change_the_order():
    cards = _make(12, CardState.REVIEW)
    orders = {tuple(_ids(order_due_cards(cards, seed=s))) for s in range(8)}
    # With 12 cards, distinct seeds should not all collapse to one order.
    assert len(orders) > 1


def test_omitting_seed_randomises_across_requests():
    cards = _make(12, CardState.REVIEW)
    orders = {tuple(_ids(order_due_cards(cards))) for _ in range(10)}
    assert len(orders) > 1


def test_ordering_preserves_all_cards_without_loss_or_duplication():
    cards = (
        _make(5, CardState.REVIEW, start=0)
        + _make(3, CardState.NEW, start=100)
        + _make(2, CardState.LEARNING, start=200)
    )
    result = order_due_cards(cards, seed=1)
    assert sorted(_ids(result)) == sorted(_ids(cards))


def test_does_not_mutate_input():
    cards = _make(6, CardState.REVIEW)
    before = _ids(cards)
    order_due_cards(cards, seed=1)
    assert _ids(cards) == before


def test_empty_input_returns_empty_list():
    assert order_due_cards([]) == []
