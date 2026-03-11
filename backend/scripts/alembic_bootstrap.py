#!/usr/bin/env python3
"""Decide whether backend startup should stamp baseline before Alembic upgrade."""

from __future__ import annotations

import os

from sqlalchemy import create_engine, inspect

# Tables owned by the backend app. Presence indicates pre-existing schema.
MANAGED_TABLES = {
    "users",
    "decks",
    "cards",
    "review_logs",
    "user_settings",
    "refresh_tokens",
    "resources",
    "user_resources",
    "page_extractions",
}


def _resolve_sync_database_url() -> str:
    url = os.getenv("DATABASE_URL_SYNC") or os.getenv("DATABASE_URL")

    if not url:
        raise RuntimeError("DATABASE_URL_SYNC or DATABASE_URL must be set")

    if url.startswith("postgresql+asyncpg://"):
        return url.replace("postgresql+asyncpg://", "postgresql+psycopg2://", 1)

    return url


def main() -> None:
    engine = create_engine(_resolve_sync_database_url(), pool_pre_ping=True)

    try:
        with engine.connect() as connection:
            tables = set(inspect(connection).get_table_names())
    finally:
        engine.dispose()

    has_alembic_version = "alembic_version" in tables
    has_existing_app_schema = bool(MANAGED_TABLES.intersection(tables))

    if not has_alembic_version and has_existing_app_schema:
        print("stamp_baseline")
        return

    print("upgrade")


if __name__ == "__main__":
    main()
