"""Fixtures for PostgreSQL integration tests.

These tests exercise what mocked sessions cannot verify: real unique
constraint conflicts, row locking under concurrency, window-count snapshots,
and JSONB round-trips. They run only when ``TEST_DATABASE_URL`` points at a
disposable PostgreSQL database (CI provides one; locally, start the compose
PostgreSQL and create a scratch database).

Each test starts from an empty schema it fully owns: metadata is dropped and
recreated per test, so no state leaks between tests.
"""

import os
from collections.abc import AsyncIterator

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncEngine, async_sessionmaker, create_async_engine
from sqlmodel import SQLModel

import app.models  # noqa: F401  (register every table on SQLModel.metadata)
from app.models import Deck, User


def _test_database_url() -> str:
    url = os.environ.get("TEST_DATABASE_URL")
    if not url:
        pytest.skip("TEST_DATABASE_URL is not set; skipping PostgreSQL integration tests")
    return url


@pytest_asyncio.fixture()
async def engine() -> AsyncIterator[AsyncEngine]:
    engine = create_async_engine(_test_database_url())
    async with engine.begin() as conn:
        await conn.run_sync(SQLModel.metadata.drop_all)
        await conn.run_sync(SQLModel.metadata.create_all)
    try:
        yield engine
    finally:
        await engine.dispose()


@pytest.fixture()
def session_factory(engine: AsyncEngine) -> async_sessionmaker:
    return async_sessionmaker(engine, expire_on_commit=False)


@pytest_asyncio.fixture()
async def user_and_deck(session_factory) -> tuple[User, Deck]:
    """One user with one deck, committed and refreshed."""
    async with session_factory() as session:
        user = User(email="integration@example.com", password_hash="hash")
        session.add(user)
        await session.flush()
        deck = Deck(user_id=user.id, name="Integration deck")
        session.add(deck)
        await session.commit()
        await session.refresh(user)
        await session.refresh(deck)
    return user, deck
