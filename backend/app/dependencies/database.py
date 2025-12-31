"""
Database session dependencies.
"""

from collections.abc import AsyncGenerator

from fastapi import HTTPException
from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import async_session_factory


async def get_async_session() -> AsyncGenerator[AsyncSession, None]:
    """
    Dependency that yields an async database session.

    Usage:
        @router.get("/items")
        async def get_items(session: AsyncSession = Depends(get_async_session)):
            ...

    The session is automatically committed on success or rolled back on error.
    """
    async with async_session_factory() as session:
        try:
            yield session
            await session.commit()
        except HTTPException:
            # HTTP exceptions are expected API responses, not errors
            await session.rollback()
            raise
        except Exception as e:
            logger.error(f"Database session error: {e}")
            await session.rollback()
            raise
