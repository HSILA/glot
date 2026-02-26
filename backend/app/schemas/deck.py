"""
Deck schemas for API request/response validation.
"""

from datetime import datetime

from pydantic import BaseModel, Field, field_validator


class DeckCreate(BaseModel):
    """Schema for creating a new deck."""

    name: str = Field(min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=1000)
    color: str | None = Field(default=None, max_length=7, description="Hex color code (e.g., '#ef4444')")
    tags: list[str] | None = Field(default=None, max_length=5, description="List of tags (max 5)")

    @field_validator('color')
    @classmethod
    def validate_color(cls, v: str | None) -> str | None:
        if v is None:
            return v
        if not v.startswith('#') or len(v) != 7:
            raise ValueError('Color must be a 7-character hex code starting with #')
        # Validate hex digits
        hex_part = v[1:]
        if not all(c in '0123456789abcdefABCDEF' for c in hex_part):
            raise ValueError('Color must contain only valid hex digits (0-9, a-f, A-F)')
        return v

    @field_validator('tags')
    @classmethod
    def validate_tags(cls, v: list[str] | None) -> list[str] | None:
        if v is None:
            return v
        for tag in v:
            if len(tag) > 20:
                raise ValueError('Each tag must be 20 characters or less')
        return v


class DeckUpdate(BaseModel):
    """Schema for updating an existing deck."""

    name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = None
    color: str | None = Field(default=None, max_length=7, description="Hex color code (e.g., '#ef4444')")
    tags: list[str] | None = Field(default=None, max_length=5, description="List of tags (max 5)")

    @field_validator('color')
    @classmethod
    def validate_color(cls, v: str | None) -> str | None:
        if v is None:
            return v
        if not v.startswith('#') or len(v) != 7:
            raise ValueError('Color must be a 7-character hex code starting with #')
        # Validate hex digits
        hex_part = v[1:]
        if not all(c in '0123456789abcdefABCDEF' for c in hex_part):
            raise ValueError('Color must contain only valid hex digits (0-9, a-f, A-F)')
        return v

    @field_validator('tags')
    @classmethod
    def validate_tags(cls, v: list[str] | None) -> list[str] | None:
        if v is None:
            return v
        for tag in v:
            if len(tag) > 20:
                raise ValueError('Each tag must be 20 characters or less')
        return v


class DeckRead(BaseModel):
    """Schema for reading a deck (response)."""

    id: int
    name: str
    description: str | None
    color: str | None
    tags: list[str] | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
