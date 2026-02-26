"""
Database connection and session management.
"""

from loguru import logger
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker
from sqlmodel import SQLModel

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
    """Initialize database tables."""
    try:
        async with async_engine.begin() as conn:
            await conn.run_sync(SQLModel.metadata.create_all)

            # NOTE: This project does not yet use a migration tool (e.g., Alembic).
            # These schema adjustments keep local dev/prod in sync with model changes.
            # Safe-guards: IF NOT EXISTS / IF EXISTS.
            await conn.execute(
                text("ALTER TABLE decks ADD COLUMN IF NOT EXISTS color VARCHAR(7)")
            )
            await conn.execute(
                text("ALTER TABLE decks ADD COLUMN IF NOT EXISTS tags JSON")
            )
            await conn.execute(text("ALTER TABLE decks DROP COLUMN IF EXISTS parent_id"))

        logger.info("Database tables created/verified")
    except Exception as e:
        logger.error(f"Failed to initialize database: {e}")
        raise


async def close_db() -> None:
    """Close database connections."""
    try:
        await async_engine.dispose()
        logger.debug("Database connections disposed")
    except Exception as e:
        logger.error(f"Error closing database: {e}")
        raise
