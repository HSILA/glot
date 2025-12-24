"""
Settings schemas for API request/response validation.
"""
from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class SettingsUpdate(BaseModel):
    """Schema for updating settings."""

    desired_retention: float | None = Field(default=None, ge=0.7, le=0.97)
    maximum_interval_days: int | None = Field(default=None, ge=1, le=36500)
    enable_fuzz: bool | None = None


class SettingsRead(BaseModel):
    """Schema for reading settings (response)."""

    id: int
    desired_retention: float
    maximum_interval_days: int
    enable_fuzz: bool
    weights: list[float] | None
    last_optimized_at: datetime | None
    optimizer_metadata: dict[str, Any] | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
