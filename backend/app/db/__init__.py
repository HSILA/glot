"""
Database connection and session management.

Schema changes are managed by Alembic migrations.
"""

from loguru import logger
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker

from app.core import get_settings

settings = get_settings()

# Async engine for application use
logger.debug(
    f"Creating database engine: {settings.database_url.split('@')[1] if '@' in settings.database_url else 'local'}"
)
async_engine = create_async_engine(
    settings.database_url,
    echo=False,  # Disable SQLAlchemy query logging
    future=True,
)

# Async session factory (used by dependencies.database)
async_session_factory = sessionmaker(
    bind=async_engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
)


async def init_db() -> None:
    """Verify database connectivity.

    Note: schema creation/migration is handled by Alembic before app startup.
    """
    try:
        async with async_engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
        logger.info("Database connection verified")
    except Exception as e:
        logger.error(f"Failed to connect to database: {e}")
        raise


async def close_db() -> None:
    """Close database connections."""
    try:
        await async_engine.dispose()
        logger.debug("Database connections disposed")
    except Exception as e:
        logger.error(f"Error closing database: {e}")
        raise
