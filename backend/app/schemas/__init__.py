"""
Pydantic schemas for API request/response validation.
"""

from .auth import (
    DeviceListResponse,
    DeviceRead,
    LoginRequest,
    MessageResponse,
    PasswordChangeRequest,
    PasswordChangeResponse,
    TokenResponse,
    UserRead,
    UserRegister,
    UserRegistered,
)
from .card import (
    CardCreate,
    CardRead,
    CardUpdate,
    NextStatesResponse,
    ReviewRequest,
    ReviewResponse,
)
from .deck import DeckCreate, DeckRead, DeckUpdate
from .settings import SettingsRead, SettingsUpdate

__all__ = [
    # Auth
    "UserRegister",
    "UserRegistered",
    "LoginRequest",
    "TokenResponse",
    "PasswordChangeRequest",
    "PasswordChangeResponse",
    "UserRead",
    "DeviceRead",
    "DeviceListResponse",
    "MessageResponse",
    # Cards
    "CardCreate",
    "CardRead",
    "CardUpdate",
    "ReviewRequest",
    "ReviewResponse",
    "NextStatesResponse",
    # Decks
    "DeckCreate",
    "DeckRead",
    "DeckUpdate",
    # Settings
    "SettingsRead",
    "SettingsUpdate",
]
