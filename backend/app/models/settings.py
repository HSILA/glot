"""
UserSettings model, per-user scheduling configuration.

Each user has their own scheduling parameters that can be optimized
based on their review history.
"""

from datetime import datetime
from typing import Any

from fsrs_rs_python import DEFAULT_PARAMETERS
from sqlalchemy import Column, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel

from app.core.datetime_utils import TimestampTZ, utc_now

# Convert to list once at module load (DEFAULT_PARAMETERS is a tuple)
_DEFAULT_WEIGHTS: list[float] = list(DEFAULT_PARAMETERS)


def get_default_weights() -> list[float]:
    """Return a copy of the default algorithm weights."""
    return _DEFAULT_WEIGHTS.copy()


class UserSettings(SQLModel, table=True):
    """
    Per-user settings for spaced repetition scheduling.

    Created automatically when a user registers.

    Per-User Settings (stored here):
        - desired_retention: Target recall probability (default: 0.9)
        - weights: Algorithm parameters (default: library defaults, 19 floats)

    Global scheduling policy (see config/scheduling.yaml):
        - maximum_interval_days: Max days between reviews
        - enable_fuzz: Add randomness to intervals
    """

    __tablename__ = "user_settings"

    id: int | None = Field(default=None, primary_key=True)
    user_id: int = Field(
        foreign_key="users.id",
        unique=True,
        index=True,
        description="One settings row per user",
    )

    # Scheduling Configuration
    desired_retention: float = Field(
        default=0.9,
        ge=0.7,
        le=0.97,
        description="Target probability of correct recall",
    )

    # Algorithm weights - initialized with defaults, updated by optimizer
    weights: list[float] = Field(
        default_factory=get_default_weights,
        sa_column=Column(JSONB, nullable=False),
        description="Algorithm parameters (21 floats)",
    )

    # Metadata for optimizer
    last_optimized_at: datetime | None = Field(
        default=None,
        description="Last time scheduling parameters were optimized",
    )
    optimizer_metadata: dict[str, Any] | None = Field(
        default=None,
        sa_column=Column(JSONB, nullable=True),
        description="Optimizer run metadata (loss, sample size, etc.)",
    )

    # Timestamps
    created_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(TimestampTZ, server_default=text("now()"), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(
            TimestampTZ, server_default=text("now()"), onupdate=utc_now, nullable=False
        ),
    )
