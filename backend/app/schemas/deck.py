"""
Deck schemas for API request/response validation.
"""

from datetime import datetime

from pydantic import BaseModel, Field, field_validator


def validate_hex_color(v: str | None) -> str | None:
    """Validate hex color format (#RRGGBB)."""
    if v is None:
        return v
    if not v.startswith('#') or len(v) != 7:
        raise ValueError('Color must be a 7-character hex code starting with #')
    hex_part = v[1:]
    if not all(c in '0123456789abcdefABCDEF' for c in hex_part):
        raise ValueError('Color must contain only valid hex digits (0-9, a-f, A-F)')
    return v


def validate_tags(v: list[str] | None) -> list[str] | None:
    """Validate tags list (max 5 tags, each max 20 chars)."""
    if v is None:
        return v
    for tag in v:
        if len(tag) > 20:
            raise ValueError('Each tag must be 20 characters or less')
    return v


class DeckCreate(BaseModel):
    """Schema for creating a new deck."""

    name: str = Field(min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=1000)
    color: str | None = Field(default=None, max_length=7, description="Hex color code (e.g., '#ef4444')")
    tags: list[str] | None = Field(default=None, max_length=5, description="List of tags (max 5)")

    _validate_color = field_validator('color')(validate_hex_color)
    _validate_tags = field_validator('tags')(validate_tags)


class DeckUpdate(BaseModel):
    """Schema for updating an existing deck."""

    name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = None
    color: str | None = Field(default=None, max_length=7, description="Hex color code (e.g., '#ef4444')")
    tags: list[str] | None = Field(default=None, max_length=5, description="List of tags (max 5)")

    _validate_color = field_validator('color')(validate_hex_color)
    _validate_tags = field_validator('tags')(validate_tags)


class DeckRead(BaseModel):
    """Schema for reading a deck (response)."""

    id: int
    name: str
    description: str | None
    color: str | None
    tags: list[str] | None
    cards_count: int = 0
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
