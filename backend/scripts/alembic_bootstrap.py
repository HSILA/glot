#!/usr/bin/env python3
"""Decide whether backend startup should stamp baseline before Alembic upgrade."""

from __future__ import annotations

import os
import sys

from sqlalchemy import create_engine, inspect
from sqlalchemy.engine.reflection import Inspector

# Tables owned by the backend app.
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

# Minimum compatibility checks before allowing automatic baseline stamping.
REQUIRED_COLUMNS: dict[str, set[str]] = {
    "users": {"id", "email", "password_hash", "is_active", "joined_at"},
    "decks": {"id", "user_id", "name", "color", "tags"},
    "cards": {
        "id",
        "deck_id",
        "sequence",
        "front_content",
        "back_content",
        "state",
        "created_at",
        "updated_at",
    },
    "review_logs": {"id", "card_id", "rating", "reviewed_at"},
    "user_settings": {"id", "user_id", "desired_retention", "weights"},
    "refresh_tokens": {"id", "user_id", "token_hash", "expires_at"},
    "resources": {
        "id",
        "content_hash",
        "file_name",
        "is_public",
        "extraction_status",
        "uploaded_by",
    },
    "user_resources": {"user_id", "resource_id", "name"},
    "page_extractions": {"id", "resource_id", "page_number", "status"},
}


def _resolve_sync_database_url() -> str:
    url = os.getenv("DATABASE_URL_SYNC") or os.getenv("DATABASE_URL")

    if not url:
        raise RuntimeError("DATABASE_URL_SYNC or DATABASE_URL must be set")

    if url.startswith("postgresql+asyncpg://"):
        return url.replace("postgresql+asyncpg://", "postgresql+psycopg2://", 1)

    return url


def _has_unique_cards_sequence(inspector: Inspector) -> bool:
    target_columns = {"deck_id", "sequence"}

    for constraint in inspector.get_unique_constraints("cards"):
        columns = set(constraint.get("column_names") or [])
        if columns == target_columns:
            return True

    for index in inspector.get_indexes("cards"):
        columns = set(index.get("column_names") or [])
        if index.get("unique") and columns == target_columns:
            return True

    return False


def _is_baseline_compatible(inspector: Inspector, tables: set[str]) -> tuple[bool, list[str]]:
    issues: list[str] = []

    missing_tables = sorted(MANAGED_TABLES - tables)
    if missing_tables:
        issues.append(f"missing tables: {', '.join(missing_tables)}")

    for table_name, required in REQUIRED_COLUMNS.items():
        if table_name not in tables:
            continue
        existing = {col["name"] for col in inspector.get_columns(table_name)}
        missing = sorted(required - existing)
        if missing:
            issues.append(
                f"table '{table_name}' missing columns: {', '.join(missing)}"
            )

    if "cards" in tables and not _has_unique_cards_sequence(inspector):
        issues.append("cards missing unique constraint/index on (deck_id, sequence)")

    return len(issues) == 0, issues


def main() -> None:
    engine = create_engine(_resolve_sync_database_url(), pool_pre_ping=True)

    try:
        with engine.connect() as connection:
            inspector = inspect(connection)
            tables = set(inspector.get_table_names())

            has_alembic_version = "alembic_version" in tables
            has_existing_app_schema = bool(MANAGED_TABLES.intersection(tables))

            if has_alembic_version or not has_existing_app_schema:
                print("upgrade")
                return

            compatible, issues = _is_baseline_compatible(inspector, tables)
            if compatible:
                print("stamp_baseline")
                return

            print("manual_required")
            print(
                "[startup] Refusing automatic baseline stamp due to incompatible schema:",
                file=sys.stderr,
            )
            for issue in issues:
                print(f"[startup] - {issue}", file=sys.stderr)
            return
    finally:
        engine.dispose()


if __name__ == "__main__":
    main()
