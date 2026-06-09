"""
Review-queue ordering for the study session.

The ``/cards/due`` endpoint selects which cards are due (respecting priority and
the result limit), then uses these helpers to decide the *presentation order* so
the queue does not feel sequential or predictable.

Ordering policy:
    1. Learning / relearning cards come first (highest priority), shuffled.
    2. Due review cards and new cards are interleaved together, each shuffled,
       so new cards are spread among reviews rather than front- or back-loaded.

Randomisation uses a per-request RNG. Passing a ``seed`` makes the order stable
across requests (useful for a stable session), while omitting it randomises the
order on every request.

These functions are pure (no DB/ORM access) so they are easy to unit-test.
"""

import random
from collections.abc import Sequence

from app.models.card import CardState

# Cards mid-learning or being relearned after a lapse are the most fragile, so
# they are surfaced first.
LEARNING_STATES = frozenset({CardState.LEARNING, CardState.RELEARNING})


def interleave[T](primary: Sequence[T], secondary: Sequence[T]) -> list[T]:
    """Evenly interleave ``secondary`` items among ``primary`` items.

    Secondary items are spread across the full span of primary items so they are
    neither clustered at the front nor at the back. The relative order within
    each input sequence is preserved.
    """
    if not secondary:
        return list(primary)
    if not primary:
        return list(secondary)

    total = len(primary) + len(secondary)
    n_secondary = len(secondary)
    result: list[T] = []
    pi = si = 0

    for k in range(total):
        # How many secondary items "should" have been emitted by this position
        # if they were spread perfectly evenly.
        target_secondary = round((k + 1) * n_secondary / total)
        take_secondary = si < n_secondary and (si < target_secondary or pi >= len(primary))
        if take_secondary:
            result.append(secondary[si])
            si += 1
        else:
            result.append(primary[pi])
            pi += 1

    return result


def order_due_cards[T](cards: Sequence[T], seed: int | None = None) -> list[T]:
    """Return due ``cards`` in presentation order.

    Learning/relearning cards come first (shuffled); due review and new cards are
    shuffled and interleaved so new cards are sprinkled among the reviews.

    Each card must expose a ``state`` attribute (:class:`CardState`). The input
    is not mutated.
    """
    rng = random.Random(seed)

    learning = [c for c in cards if c.state in LEARNING_STATES]
    new = [c for c in cards if c.state == CardState.NEW]
    # Everything else (i.e. due REVIEW cards) — defined as a catch-all so no
    # card is ever dropped from the queue.
    review = [c for c in cards if c.state not in LEARNING_STATES and c.state != CardState.NEW]

    rng.shuffle(learning)
    rng.shuffle(review)
    rng.shuffle(new)

    return learning + interleave(review, new)
