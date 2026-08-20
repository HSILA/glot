"""
FSRS (Free Spaced Repetition Scheduler) service.

This service encapsulates all FSRS algorithm logic using fsrs-rs-python.
It handles:
- Calculating next review intervals based on ratings
- Converting between our Card model and FSRS memory states
- Logging reviews for future optimizer training

FSRS Rating Scale:
    1 = Again (Failed recall, stability resets)
    2 = Hard  (Difficult recall, small stability increase)
    3 = Good  (Normal recall, standard stability increase)
    4 = Easy  (Effortless recall, large stability increase)
"""

import hashlib
import math
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING

from fsrs_rs_python import DEFAULT_PARAMETERS, FSRS, MemoryState

from app.models.card import Card, CardState
from app.schemas.card import NextStatesResponse, SchedulingInfo

# Rating Again should keep the failed card due immediately today. The frontend
# controls active-session spacing; this persisted timestamp preserves the retry
# if the browser session is interrupted.
AGAIN_RETRY_DELAY = timedelta(0)

# Official Anki/FSRS fuzz ranges: (range_start, range_end, delta_per_day).
# The +1 base below plus these per-day contributions widen the fuzz window as
# the interval grows, mirroring Anki's `fuzz_range` implementation.
FUZZ_RANGES = ((2.5, 7.0, 0.15), (7.0, 20.0, 0.10), (20.0, float("inf"), 0.05))


def _round_days(value: float) -> int:
    """Match Go/Anki's positive half-up day rounding."""
    return math.floor(value + 0.5)

if TYPE_CHECKING:
    from fsrs_rs_python import NextStates


class FSRSService:
    """
    Service for FSRS spaced repetition scheduling.

    Uses fsrs-rs-python (Rust bindings) for efficient scheduling.
    Lightweight (~6MB) compared to PyTorch-based alternatives (~2GB).
    """

    def __init__(
        self,
        *,
        maximum_interval_days: int,
        enable_fuzz: bool,
        desired_retention: float = 0.9,
        weights: list[float] | None = None,
    ):
        """
        Initialize scheduling service with configuration.

        The global policy values are required and have no defaults here: they
        come from config/app.yaml (see app.core.app_config). Forgetting to
        pass them is a TypeError rather than a silently wrong schedule.

        Args:
            maximum_interval_days: Maximum days between reviews (global policy)
            enable_fuzz: Add randomness to prevent review clumping (global policy)
            desired_retention: Target recall probability (per-user setting)
            weights: Algorithm parameters (per-user, None = use library defaults)
        """
        self.desired_retention = desired_retention
        self.maximum_interval_days = maximum_interval_days
        self.enable_fuzz = enable_fuzz

        # Use custom weights if provided, otherwise defaults
        parameters = weights if weights else DEFAULT_PARAMETERS
        self.fsrs = FSRS(parameters=parameters)

    def get_memory_state(self, card: Card) -> MemoryState | None:
        """
        Convert a Card to FSRS MemoryState.

        Returns None for new cards (no memory state yet).
        """
        if card.state == CardState.NEW or card.stability == 0:
            return None

        return MemoryState(
            stability=card.stability,
            difficulty=card.difficulty,
        )

    def calculate_elapsed_days(self, card: Card) -> int:
        """Calculate days since last review."""
        if card.last_review_at is None:
            return 0

        now = datetime.now(UTC)
        last_review = card.last_review_at
        if last_review.tzinfo is None:
            last_review = last_review.replace(tzinfo=UTC)

        elapsed = (now - last_review).days
        return max(0, elapsed)

    def get_next_states(
        self,
        card: Card,
        elapsed_days: int | None = None,
    ) -> "NextStates":
        """
        Get possible next states for all rating options.

        Returns FSRS NextStates with .again, .hard, .good, .easy
        """
        memory_state = self.get_memory_state(card)
        if elapsed_days is None:
            elapsed_days = self.calculate_elapsed_days(card)

        return self.fsrs.next_states(
            memory_state,
            self.desired_retention,
            elapsed_days,
        )

    def _fuzz_factor(self, card: Card, elapsed_days: int) -> float:
        """
        Stable pseudo-random fraction in [0, 1), derived only from fields that
        stay unchanged between a preview call and an immediately following
        apply_review call on the same (not-yet-reviewed) card. Using a hash
        instead of Python's randomized str/object hashing keeps the factor
        identical across processes, while varying per card identity/state.
        """
        seed = f"{card.id}:{card.reps}:{card.stability}:{card.difficulty}:{elapsed_days}"
        digest = hashlib.sha256(seed.encode()).digest()
        return int.from_bytes(digest[:8], "big") / 2**64

    @staticmethod
    def _fuzz_bounds(
        interval: int,
        elapsed_days: int,
        maximum_interval: int,
    ) -> tuple[int, int]:
        """Return the official inclusive FSRS fuzz range."""
        capped_interval = min(interval, maximum_interval)
        delta = 1.0
        for start, end, factor in FUZZ_RANGES:
            delta += factor * max(min(capped_interval, end) - start, 0.0)

        min_ivl = max(2, _round_days(capped_interval - delta))
        max_ivl = min(_round_days(capped_interval + delta), maximum_interval)
        if capped_interval > elapsed_days:
            min_ivl = max(min_ivl, elapsed_days + 1)
        min_ivl = min(min_ivl, max_ivl)
        return min_ivl, max_ivl

    def _resolve_interval(
        self,
        raw_interval: float,
        *,
        elapsed_days: int,
        fraction: float,
    ) -> int:
        """
        Shared interval policy used by both preview and persistence: round and
        cap the base interval, then (if enabled) fuzz it deterministically within
        the official Anki/FSRS ranges. Intervals below 2.5 days are never fuzzed.
        """
        base = min(
            max(1, _round_days(raw_interval)),
            self.maximum_interval_days,
        )
        if not self.enable_fuzz or base < 2.5:
            return min(base, self.maximum_interval_days)

        min_ivl, max_ivl = self._fuzz_bounds(
            base,
            elapsed_days,
            self.maximum_interval_days,
        )

        span = max_ivl - min_ivl + 1
        offset = min(int(fraction * span), span - 1)
        return min_ivl + offset

    def _resolve_passing_intervals(
        self,
        next_states: "NextStates",
        *,
        elapsed_days: int,
        fraction: float,
    ) -> dict[int, int]:
        """Resolve Hard/Good/Easy together so fuzz cannot invert their order."""
        hard = self._resolve_interval(
            next_states.hard.interval,
            elapsed_days=elapsed_days,
            fraction=fraction,
        )
        good = self._resolve_interval(
            next_states.good.interval,
            elapsed_days=elapsed_days,
            fraction=fraction,
        )
        easy = self._resolve_interval(
            next_states.easy.interval,
            elapsed_days=elapsed_days,
            fraction=fraction,
        )

        hard = min(hard, good)
        good = max(good, min(hard + 1, self.maximum_interval_days))
        easy = max(easy, min(good + 1, self.maximum_interval_days))
        return {2: hard, 3: good, 4: easy}

    def get_next_states_response(self, card: Card) -> NextStatesResponse:
        """Get next states as API response schema."""
        elapsed_days = self.calculate_elapsed_days(card)
        next_states = self.get_next_states(card, elapsed_days)
        fraction = self._fuzz_factor(card, elapsed_days)
        intervals = self._resolve_passing_intervals(
            next_states,
            elapsed_days=elapsed_days,
            fraction=fraction,
        )

        return NextStatesResponse(
            again=SchedulingInfo(
                interval_days=0,
                new_difficulty=round(next_states.again.memory.difficulty, 2),
                new_stability=round(next_states.again.memory.stability, 2),
            ),
            hard=SchedulingInfo(
                interval_days=intervals[2],
                new_difficulty=round(next_states.hard.memory.difficulty, 2),
                new_stability=round(next_states.hard.memory.stability, 2),
            ),
            good=SchedulingInfo(
                interval_days=intervals[3],
                new_difficulty=round(next_states.good.memory.difficulty, 2),
                new_stability=round(next_states.good.memory.stability, 2),
            ),
            easy=SchedulingInfo(
                interval_days=intervals[4],
                new_difficulty=round(next_states.easy.memory.difficulty, 2),
                new_stability=round(next_states.easy.memory.stability, 2),
            ),
        )

    def apply_review(self, card: Card, rating: int) -> tuple[Card, int, int]:
        """
        Apply a review rating to a card and update its scheduling.

        Args:
            card: The card being reviewed
            rating: User rating (1=Again, 2=Hard, 3=Good, 4=Easy)

        Returns:
            Tuple of (updated_card, scheduled_days, elapsed_days)
            scheduled_days and elapsed_days are for ReviewLog
        """
        # Get current state for logging
        elapsed_days = self.calculate_elapsed_days(card)
        scheduled_days = 0
        if card.next_review_at and card.last_review_at:
            scheduled_days = (card.next_review_at - card.last_review_at).days

        # Get next states and select based on rating
        next_states = self.get_next_states(card, elapsed_days)
        fraction = self._fuzz_factor(card, elapsed_days)
        intervals = self._resolve_passing_intervals(
            next_states,
            elapsed_days=elapsed_days,
            fraction=fraction,
        )

        rating_map = {
            1: next_states.again,
            2: next_states.hard,
            3: next_states.good,
            4: next_states.easy,
        }
        selected_state = rating_map[rating]

        # Same shared policy as get_next_states_response, so the previewed and
        # persisted interval for an unreviewed card always agree. Again is
        # persisted as due immediately so an interrupted session still
        # surfaces the failed card today.
        interval_days = (
            0
            if rating == 1
            else intervals[rating]
        )

        # Update card fields
        card.difficulty = selected_state.memory.difficulty
        card.stability = selected_state.memory.stability
        card.reps += 1

        # Track lapses (rating = 1 means forgot)
        if rating == 1:
            card.lapses += 1
            card.state = CardState.RELEARNING
        elif card.state == CardState.NEW:
            card.state = CardState.LEARNING
        else:
            card.state = CardState.REVIEW

        # Update timestamps
        now = datetime.now(UTC)
        card.last_review_at = now
        if rating == 1:
            card.next_review_at = now + AGAIN_RETRY_DELAY
        else:
            card.next_review_at = now + timedelta(days=interval_days)
        card.updated_at = now

        return card, scheduled_days, elapsed_days
