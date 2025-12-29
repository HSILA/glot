"""
SQLModel database models for Glot.

Models:
- User: Authentication and identity
- UserSettings: Per-user scheduling configuration
- RefreshToken: Multi-device session tokens
- Deck: User-owned card organization
- Card: The core flashcard entity with scheduling fields
- ReviewLog: Historical review data for algorithm optimization

Ownership Hierarchy:
    User
    ├── UserSettings (1:1)
    ├── RefreshToken (1:many) - one per device
    └── Deck (1:many)
        └── Card (1:many)
            └── ReviewLog (1:many)
"""

from .card import Card, CardState
from .deck import Deck
from .refresh_token import RefreshToken
from .review_log import ReviewLog
from .settings import UserSettings
from .user import User

__all__ = [
    "User",
    "UserSettings",
    "RefreshToken",
    "Deck",
    "Card",
    "CardState",
    "ReviewLog",
]
