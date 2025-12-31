"""
SQLModel database models for Glot.

Models:
- User: Authentication and identity
- UserSettings: Per-user scheduling configuration
- RefreshToken: Multi-device session tokens
- Deck: User-owned card organization
- Card: The core flashcard entity with scheduling fields
- ReviewLog: Historical review data for algorithm optimization
- Resource: Global resource storage with content-based deduplication
- UserResource: Junction table linking users to resources

Ownership Hierarchy:
    User
    ├── UserSettings (1:1)
    ├── RefreshToken (1:many) - one per device
    ├── Deck (1:many)
    │   └── Card (1:many)
    │       └── ReviewLog (1:many)
    └── UserResource (1:many) > Resource (many:1)
"""

from .card import Card, CardState
from .deck import Deck
from .refresh_token import RefreshToken
from .resource import ExtractionStatus, PageExtraction, PageStatus, Resource
from .review_log import ReviewLog
from .settings import UserSettings
from .user import User
from .user_resource import UserResource

__all__ = [
    "User",
    "UserSettings",
    "RefreshToken",
    "Deck",
    "Card",
    "CardState",
    "ReviewLog",
    "Resource",
    "ExtractionStatus",
    "PageExtraction",
    "PageStatus",
    "UserResource",
]
