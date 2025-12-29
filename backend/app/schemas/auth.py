"""
Authentication schemas for API request/response validation.
"""

from datetime import datetime

from pydantic import BaseModel, EmailStr, field_validator

from app.core.security import validate_password_strength


class UserRegister(BaseModel):
    """Schema for user registration."""

    email: EmailStr
    password: str
    display_name: str | None = None

    @field_validator("password")
    @classmethod
    def validate_password(cls, v: str) -> str:
        return validate_password_strength(v)


class UserRegistered(BaseModel):
    """Response after successful registration."""

    id: int
    email: str
    display_name: str | None
    message: str = "Registration successful. Please log in."

    model_config = {"from_attributes": True}


class LoginRequest(BaseModel):
    """Schema for login request."""

    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    """Response containing access token info (refresh token is in cookie)."""

    access_token: str
    token_type: str = "bearer"
    expires_in: int  # Seconds until access token expires

    model_config = {"from_attributes": True}


class PasswordChangeRequest(BaseModel):
    """Schema for password change."""

    current_password: str
    new_password: str

    @field_validator("new_password")
    @classmethod
    def validate_new_password(cls, v: str) -> str:
        return validate_password_strength(v)


class PasswordChangeResponse(BaseModel):
    """Response after password change."""

    message: str = "Password changed successfully"


class UserRead(BaseModel):
    """Schema for reading user profile."""

    id: int
    email: str
    display_name: str | None
    is_active: bool
    joined_at: datetime

    model_config = {"from_attributes": True}


class DeviceRead(BaseModel):
    """Schema for reading a device/session."""

    id: int
    device_name: str | None
    created_at: datetime
    last_used_at: datetime
    is_current: bool = False  # Set by endpoint if this is the requesting device

    model_config = {"from_attributes": True}


class DeviceListResponse(BaseModel):
    """Response containing list of active devices."""

    devices: list[DeviceRead]
    total: int


class MessageResponse(BaseModel):
    """Generic message response."""

    message: str
