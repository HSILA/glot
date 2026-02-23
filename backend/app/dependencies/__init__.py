"""
Shared dependencies for FastAPI endpoints.

This package contains reusable dependency functions that can be
injected into route handlers using FastAPI's Depends() system.

Modules:
    - database: Database session dependencies
    - auth: Authentication dependencies
    - storage: Storage service dependencies
    - settings: User settings helpers
"""

from .auth import get_current_user
from .database import get_async_session
from .settings import get_user_settings
from .storage import get_storage_service

__all__ = [
    "get_async_session",
    "get_current_user",
    "get_user_settings",
    "get_storage_service",
]
