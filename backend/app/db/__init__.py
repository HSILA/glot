"""
Database connection and session management.
"""
from collections.abc import AsyncGenerator

from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker
from sqlmodel import SQLModel

from app.core import get_settings

settings = get_settings()

# Async engine for application use
logger.debug(f"Creating database engine: {settings.database_url.split('@')[1] if '@' in settings.database_url else 'local'}")
async_engine = create_async_engine(
    settings.database_url,
    echo=False,  # Disable SQLAlchemy query logging
    future=True,
)

# Async session factory
async_session_factory = sessionmaker(
    bind=async_engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
)


async def get_async_session() -> AsyncGenerator[AsyncSession, None]:
    """Dependency that yields an async database session."""
    async with async_session_factory() as session:
        try:
            yield session
            await session.commit()
        except Exception as e:
            logger.error(f"Database session error: {e}")
            await session.rollback()
            raise


async def init_db() -> None:
    """Initialize database tables."""
    try:
        async with async_engine.begin() as conn:
            await conn.run_sync(SQLModel.metadata.create_all)
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
