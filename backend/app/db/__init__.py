"""
Database connection and session management.

Schema changes are managed by Alembic migrations.
"""

from urllib.parse import parse_qs, urlparse

from loguru import logger
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import NullPool

from app.core import get_settings
from app.core.app_config import get_app_config

settings = get_settings()
app_config = get_app_config()


def _is_pooler_connection(database_url: str) -> bool:
    """Detect common external pooler endpoints where SQLAlchemy pooling should be disabled."""
    parsed = urlparse(database_url)
    host = (parsed.hostname or "").lower()

    is_supabase_pooler = host.endswith("pooler.supabase.com")
    is_neon_pooler = "neon.tech" in host and "pooler" in host
    is_pooler_port = parsed.port == 6543

    return is_supabase_pooler or is_neon_pooler or is_pooler_port


def build_async_engine_config() -> dict:
    """Build SQLAlchemy async engine kwargs based on settings and provider mode."""
    config: dict = {
        "echo": False,
        "future": True,
    }

    use_null_pool = settings.database_use_null_pool or _is_pooler_connection(
        settings.database_url
    )

    if use_null_pool:
        config["poolclass"] = NullPool
        parsed = urlparse(settings.database_url)
        query_params = parse_qs(parsed.query)
        if "neon.tech" in (parsed.hostname or "").lower() and "pgbouncer" not in query_params:
            config["connect_args"] = {"prepared_statement_cache_size": 0}
        return config

    config.update(
        {
            "pool_pre_ping": app_config.database_pool.pre_ping,
            "pool_recycle": app_config.database_pool.recycle_seconds,
            "pool_size": app_config.database_pool.size,
            "max_overflow": app_config.database_pool.max_overflow,
            "pool_timeout": app_config.database_pool.timeout_seconds,
        }
    )

    return config


# Async engine for application use
logger.debug(
    f"Creating database engine: {settings.database_url.split('@')[1] if '@' in settings.database_url else 'local'}"
)
async_engine = create_async_engine(settings.database_url, **build_async_engine_config())

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
