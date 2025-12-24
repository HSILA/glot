"""
AppSettings model - Global FSRS configuration.

Stores the user-configurable settings for the FSRS algorithm.
Only ONE row should exist in this table (singleton pattern).
"""
from datetime import datetime
from typing import Any

from sqlalchemy import Column, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel


class AppSettings(SQLModel, table=True):
    """
    Global application settings for FSRS algorithm.

    This is a singleton table - only one row should exist.

    Settings:
        - desired_retention: Target recall probability (0.7-0.97)
        - maximum_interval_days: Cap on longest review interval
        - enable_fuzz: Add randomness to prevent review clumping
        - weights: 21 FSRS parameters (null = use defaults)
    """

    __tablename__ = "app_settings"

    id: int | None = Field(default=None, primary_key=True)

    # FSRS Configuration
    desired_retention: float = Field(default=0.9, ge=0.7, le=0.97)
    maximum_interval_days: int = Field(default=365, ge=1, le=36500)
    enable_fuzz: bool = Field(default=True)

    # FSRS weights (21 parameters, null = use defaults)
    # Only updated by the optimizer, not manually
    weights: list[float] | None = Field(
        default=None,
        sa_column=Column(JSONB, nullable=True),
    )

    # Metadata for optimizer
    last_optimized_at: datetime | None = Field(default=None)
    optimizer_metadata: dict[str, Any] | None = Field(
        default=None,
        sa_column=Column(JSONB, nullable=True),
    )

    # Timestamps
    created_at: datetime = Field(
        default_factory=datetime.utcnow,
        sa_column_kwargs={"server_default": text("now()")},
    )
    updated_at: datetime = Field(
        default_factory=datetime.utcnow,
        sa_column_kwargs={"server_default": text("now()"), "onupdate": datetime.utcnow},
    )
