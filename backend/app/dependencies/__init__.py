"""
Shared dependencies for FastAPI endpoints.

This package contains reusable dependency functions that can be
injected into route handlers using FastAPI's Depends() system.

Modules:
    - database: Database session dependencies
    - auth: Authentication dependencies
"""

from .auth import get_current_user
from .database import get_async_session

__all__ = [
    "get_async_session",
    "get_current_user",
]
