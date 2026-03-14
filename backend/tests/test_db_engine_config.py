from types import SimpleNamespace

from sqlalchemy.pool import NullPool

from app import db


def test_detects_pooler_urls():
    assert db._is_pooler_connection(
        "postgresql+asyncpg://u:p@aws-0-us-east-1.pooler.supabase.com:6543/postgres"
    )
    assert db._is_pooler_connection(
        "postgresql+asyncpg://u:p@ep-cool-pooler.us-east-1.aws.neon.tech/neondb"
    )
    assert db._is_pooler_connection("postgresql+asyncpg://u:p@db.example.com:6543/app")
    assert not db._is_pooler_connection("postgresql+asyncpg://u:p@db.example.com:5432/app")


def test_build_async_engine_config_direct_db_uses_tuned_pool(monkeypatch):
    monkeypatch.setattr(
        db,
        "settings",
        SimpleNamespace(
            database_url="postgresql+asyncpg://u:p@db.example.com:5432/app",
            database_use_null_pool=False,
            database_pool_pre_ping=True,
            database_pool_recycle=1800,
            database_pool_size=10,
            database_max_overflow=20,
            database_pool_timeout=30.0,
        ),
    )

    cfg = db.build_async_engine_config()

    assert cfg["pool_pre_ping"] is True
    assert cfg["pool_recycle"] == 1800
    assert cfg["pool_size"] == 10
    assert cfg["max_overflow"] == 20
    assert cfg["pool_timeout"] == 30.0
    assert "poolclass" not in cfg


def test_build_async_engine_config_pooler_uses_null_pool(monkeypatch):
    monkeypatch.setattr(
        db,
        "settings",
        SimpleNamespace(
            database_url="postgresql+asyncpg://u:p@ep-cool-pooler.us-east-1.aws.neon.tech/neondb",
            database_use_null_pool=False,
            database_pool_pre_ping=True,
            database_pool_recycle=1800,
            database_pool_size=10,
            database_max_overflow=20,
            database_pool_timeout=30.0,
        ),
    )

    cfg = db.build_async_engine_config()

    assert cfg["poolclass"] is NullPool
    assert cfg["connect_args"] == {"server_settings": {"statement_cache_size": "0"}}
    assert "pool_size" not in cfg


def test_build_async_engine_config_manual_null_pool_override(monkeypatch):
    monkeypatch.setattr(
        db,
        "settings",
        SimpleNamespace(
            database_url="postgresql+asyncpg://u:p@db.example.com:5432/app",
            database_use_null_pool=True,
            database_pool_pre_ping=True,
            database_pool_recycle=1800,
            database_pool_size=10,
            database_max_overflow=20,
            database_pool_timeout=30.0,
        ),
    )

    cfg = db.build_async_engine_config()

    assert cfg["poolclass"] is NullPool
    assert "pool_size" not in cfg
