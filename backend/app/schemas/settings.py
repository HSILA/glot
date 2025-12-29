"""
Settings schemas for API request/response validation.
"""

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class SettingsUpdate(BaseModel):
    """Schema for updating user settings."""

    desired_retention: float | None = Field(default=None, ge=0.7, le=0.97)


class SettingsRead(BaseModel):
    """Schema for reading user settings (response)."""

    id: int
    user_id: int

    # User-configurable
    desired_retention: float

    # Algorithm weights
    weights: list[float]
    last_optimized_at: datetime | None
    optimizer_metadata: dict[str, Any] | None

    # Timestamps
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
