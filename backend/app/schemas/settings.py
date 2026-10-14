"""
Settings schemas for API request/response validation.
"""

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field, field_validator

from app.core.timezones import TIMEZONE_MAX_LENGTH, is_valid_timezone


class SettingsUpdate(BaseModel):
    """Schema for updating user settings."""

    desired_retention: float | None = Field(default=None, ge=0.7, le=0.97)
    timezone: str | None = Field(
        default=None,
        max_length=TIMEZONE_MAX_LENGTH,
        description="IANA timezone for the study calendar; explicit null is rejected",
    )

    @field_validator("timezone")
    @classmethod
    def validate_timezone(cls, value: str | None) -> str | None:
        """Reject explicit null, blanks, offsets, and unknown IANA names (422)."""
        if value is None:
            raise ValueError(
                "timezone cannot be null; omit the field to keep it unchanged"
            )
        name = value.strip()
        if not name:
            raise ValueError("timezone must not be blank")
        if not is_valid_timezone(name):
            raise ValueError("timezone must be a supported IANA name")
        return name


class SettingsRead(BaseModel):
    """Schema for reading user settings (response)."""

    id: int
    user_id: int

    # User-configurable
    desired_retention: float
    timezone: str | None

    # Algorithm weights
    weights: list[float]
    last_optimized_at: datetime | None
    optimizer_metadata: dict[str, Any] | None

    # Timestamps
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
