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
    CardListResponse,
    CardMetadata,
    CardRead,
    CardUpdate,
    NextStatesResponse,
    ReviewRequest,
    ReviewResponse,
)
from .deck import DeckCreate, DeckRead, DeckUpdate
from .resource import (
    AddPublicResourceRequest,
    ExtractionProgressResponse,
    ResourceListResponse,
    ResourceRead,
    ResourceUpdateRequest,
    UploadConfirmRequest,
    UploadRequest,
    UploadResponse,
)
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
    "CardListResponse",
    "CardMetadata",
    "CardUpdate",
    "ReviewRequest",
    "ReviewResponse",
    "NextStatesResponse",
    # Decks
    "DeckCreate",
    "DeckRead",
    "DeckUpdate",
    # Resources
    "UploadRequest",
    "UploadResponse",
    "UploadConfirmRequest",
    "ResourceRead",
    "ResourceListResponse",
    "ExtractionProgressResponse",
    "AddPublicResourceRequest",
    "ResourceUpdateRequest",
    # Settings
    "SettingsRead",
    "SettingsUpdate",
]
