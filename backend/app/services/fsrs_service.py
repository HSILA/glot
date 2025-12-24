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
from datetime import datetime, timedelta, timezone
from typing import TYPE_CHECKING

from fsrs_rs_python import DEFAULT_PARAMETERS, FSRS, MemoryState

from app.models.card import Card, CardState
from app.schemas.card import NextStatesResponse, SchedulingInfo

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
        desired_retention: float = 0.9,
        maximum_interval_days: int = 365,
        enable_fuzz: bool = True,
        weights: list[float] | None = None,
    ):
        """
        Initialize FSRS service with configuration.

        Args:
            desired_retention: Target recall probability (0.7-0.97)
            maximum_interval_days: Maximum days between reviews
            enable_fuzz: Add randomness to prevent review clumping
            weights: Custom FSRS parameters (None = use defaults)
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

        now = datetime.now(timezone.utc)
        last_review = card.last_review_at
        if last_review.tzinfo is None:
            last_review = last_review.replace(tzinfo=timezone.utc)

        elapsed = (now - last_review).days
        return max(0, elapsed)

    def get_next_states(self, card: Card) -> "NextStates":
        """
        Get possible next states for all rating options.

        Returns FSRS NextStates with .again, .hard, .good, .easy
        """
        memory_state = self.get_memory_state(card)
        elapsed_days = self.calculate_elapsed_days(card)

        return self.fsrs.next_states(
            memory_state,
            self.desired_retention,
            elapsed_days,
        )

    def get_next_states_response(self, card: Card) -> NextStatesResponse:
        """Get next states as API response schema."""
        next_states = self.get_next_states(card)

        return NextStatesResponse(
            again=SchedulingInfo(
                interval_days=round(next_states.again.interval, 2),
                new_difficulty=round(next_states.again.memory.difficulty, 2),
                new_stability=round(next_states.again.memory.stability, 2),
            ),
            hard=SchedulingInfo(
                interval_days=round(next_states.hard.interval, 2),
                new_difficulty=round(next_states.hard.memory.difficulty, 2),
                new_stability=round(next_states.hard.memory.stability, 2),
            ),
            good=SchedulingInfo(
                interval_days=round(next_states.good.interval, 2),
                new_difficulty=round(next_states.good.memory.difficulty, 2),
                new_stability=round(next_states.good.memory.stability, 2),
            ),
            easy=SchedulingInfo(
                interval_days=round(next_states.easy.interval, 2),
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
        next_states = self.get_next_states(card)

        rating_map = {
            1: next_states.again,
            2: next_states.hard,
            3: next_states.good,
            4: next_states.easy,
        }
        selected_state = rating_map[rating]

        # Calculate new interval (capped by maximum)
        interval_days = min(
            int(max(1, round(selected_state.interval))),
            self.maximum_interval_days,
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
        now = datetime.now(timezone.utc)
        card.last_review_at = now
        card.next_review_at = now + timedelta(days=interval_days)
        card.updated_at = now

        return card, scheduled_days, elapsed_days


def get_fsrs_service(
    desired_retention: float = 0.9,
    maximum_interval_days: int = 365,
    enable_fuzz: bool = True,
    weights: list[float] | None = None,
) -> FSRSService:
    """Factory function to create FSRS service with settings."""
    return FSRSService(
        desired_retention=desired_retention,
        maximum_interval_days=maximum_interval_days,
        enable_fuzz=enable_fuzz,
        weights=weights,
    )
