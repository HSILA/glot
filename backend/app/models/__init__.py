"""
SQLModel database models for Glot.

Models:
- User: Authentication and identity
- UserSettings: Per-user scheduling configuration
- Deck: User-owned card organization
- Card: The core flashcard entity with scheduling fields
- ReviewLog: Historical review data for algorithm optimization

Ownership Hierarchy:
    User
    ├── UserSettings (1:1)
    └── Deck (1:many)
        └── Card (1:many)
            └── ReviewLog (1:many)
"""
from .card import Card, CardState
from .deck import Deck
from .review_log import ReviewLog
from .settings import UserSettings
from .user import User

__all__ = [
    "User",
    "UserSettings",
    "Deck",
    "Card",
    "CardState",
    "ReviewLog",
]
