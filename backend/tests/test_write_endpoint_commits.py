"""Regression tests for issue #116: write endpoints must commit before responding.

The session dependency commits in post-response teardown, so a failed commit
used to leave the client with a success response while the change rolled back
(an undetected phantom success). Write endpoints now commit explicitly before
they return, and a failed commit surfaces as a raised error instead.
"""

from unittest.mock import AsyncMock, Mock

import pytest
from fastapi import HTTPException
from sqlalchemy import TextClause
from sqlalchemy.exc import IntegrityError

from app.api.v1.cards import create_card, delete_card, update_card
from app.api.v1.decks import create_deck, delete_deck, update_deck
from app.api.v1.resources import delete_resource
from app.models import Card, Deck, Resource, User, UserResource
from app.schemas.card import CardCreate, CardUpdate
from app.schemas.deck import DeckCreate, DeckUpdate

USER = User(id=1, email="user@example.com", password_hash="hash")


def _one_or_none(value):
    result = Mock()
    result.scalar_one_or_none.return_value = value
    return result


def _scalar(value):
    result = Mock()
    result.scalar.return_value = value
    return result


def _scalar_one(value):
    result = Mock()
    result.scalar_one.return_value = value
    return result


def _make_resource(**overrides):
    values = dict(
        id=1,
        content_hash="a" * 64,
        size_bytes=10,
        file_name="document.pdf",
        uploaded_by=1,
        upload_confirmed=True,
    )
    values.update(overrides)
    return Resource(**values)


def _deletable_resource_session(execute_results):
    resource = _make_resource()
    link = UserResource(user_id=1, resource_id=1, name="Document")
    session = AsyncMock()
    session.get.return_value = resource
    session.execute.side_effect = [_one_or_none(link), *execute_results]
    return resource, link, session


@pytest.mark.asyncio
async def test_delete_card_commits_before_returning() -> None:
    card = Card(
        id=1, deck_id=1, sequence=1, front_content="front", back_content="back"
    )
    session = AsyncMock()
    session.execute.return_value = _one_or_none(card)

    await delete_card(card_id=1, session=session, current_user=USER)

    session.delete.assert_awaited_once_with(card)
    session.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_delete_card_surfaces_commit_failure() -> None:
    card = Card(
        id=1, deck_id=1, sequence=1, front_content="front", back_content="back"
    )
    session = AsyncMock()
    session.execute.return_value = _one_or_none(card)
    session.commit.side_effect = IntegrityError(
        "DELETE FROM cards", {}, Exception("fk violation")
    )

    with pytest.raises(IntegrityError):
        await delete_card(card_id=1, session=session, current_user=USER)


@pytest.mark.asyncio
async def test_delete_deck_refuses_while_cards_exist() -> None:
    deck = Deck(id=1, user_id=1, name="Deck")
    session = AsyncMock()
    session.execute.side_effect = [_one_or_none(deck), _scalar(3)]

    with pytest.raises(HTTPException) as exc:
        await delete_deck(deck_id=1, session=session, current_user=USER)

    assert exc.value.status_code == 409
    session.delete.assert_not_awaited()
    session.commit.assert_not_awaited()


@pytest.mark.asyncio
async def test_delete_deck_commits_when_empty() -> None:
    deck = Deck(id=1, user_id=1, name="Deck")
    session = AsyncMock()
    session.execute.side_effect = [_one_or_none(deck), _scalar(0)]

    await delete_deck(deck_id=1, session=session, current_user=USER)

    session.delete.assert_awaited_once_with(deck)
    session.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_delete_resource_commits_before_storage_cleanup() -> None:
    events: list[str] = []
    resource, link, session = _deletable_resource_session(
        [_scalar(0), Mock(), _scalar(0)]
    )
    session.commit.side_effect = lambda: events.append("commit")
    storage = Mock()
    storage.async_delete_file = AsyncMock(
        side_effect=lambda *args, **kwargs: events.append("storage")
    )
    storage.async_delete_processed_folder = AsyncMock(
        side_effect=lambda *args, **kwargs: events.append("storage")
    )

    await delete_resource(
        resource_id=1, session=session, current_user=USER, storage=storage
    )

    session.delete.assert_any_await(link)
    session.delete.assert_any_await(resource)
    session.commit.assert_awaited_once()
    executed = [call.args[0] for call in session.execute.await_args_list]
    assert any(isinstance(statement, TextClause) for statement in executed)
    assert events and events[0] == "commit"
    assert "storage" in events


@pytest.mark.asyncio
async def test_delete_resource_skips_shared_storage_when_hash_reused() -> None:
    """A re-uploaded hash keeps its content-addressed objects."""
    _, _, session = _deletable_resource_session([_scalar(0), Mock(), _scalar(1)])
    storage = Mock()
    storage.async_delete_file = AsyncMock()
    storage.async_delete_processed_folder = AsyncMock()

    await delete_resource(
        resource_id=1, session=session, current_user=USER, storage=storage
    )

    session.commit.assert_awaited_once()
    storage.async_delete_file.assert_not_awaited()
    storage.async_delete_processed_folder.assert_not_awaited()


@pytest.mark.asyncio
async def test_delete_resource_keeps_stored_files_when_commit_fails() -> None:
    _, _, session = _deletable_resource_session([_scalar(0)])
    session.commit.side_effect = RuntimeError("database is down")
    storage = Mock()
    storage.async_delete_file = AsyncMock()
    storage.async_delete_processed_folder = AsyncMock()

    with pytest.raises(RuntimeError):
        await delete_resource(
            resource_id=1, session=session, current_user=USER, storage=storage
        )

    storage.async_delete_file.assert_not_awaited()
    storage.async_delete_processed_folder.assert_not_awaited()


@pytest.mark.asyncio
async def test_create_card_commits_before_returning() -> None:
    deck = Deck(id=1, user_id=1, name="Deck")
    events: list[str] = []
    session = AsyncMock()
    session.add = Mock()
    session.execute.side_effect = [
        _one_or_none(deck),
        _one_or_none(deck),
        _scalar_one(1),
    ]
    session.flush.side_effect = lambda: events.append("flush")
    session.refresh.side_effect = lambda *args, **kwargs: events.append("refresh")
    session.commit.side_effect = lambda: events.append("commit")

    card = await create_card(
        card_data=CardCreate(deck_id=1, front_content="front", back_content="back"),
        session=session,
        current_user=USER,
    )

    session.add.assert_called_once()
    assert card.sequence == 1
    assert events == ["flush", "refresh", "commit"]


@pytest.mark.asyncio
async def test_update_card_commits_before_returning() -> None:
    card = Card(
        id=1, deck_id=1, sequence=1, front_content="front", back_content="back"
    )
    events: list[str] = []
    session = AsyncMock()
    session.execute.return_value = _one_or_none(card)
    session.flush.side_effect = lambda: events.append("flush")
    session.refresh.side_effect = lambda *args, **kwargs: events.append("refresh")
    session.commit.side_effect = lambda: events.append("commit")

    updated = await update_card(
        card_id=1,
        card_data=CardUpdate(front_content="changed"),
        session=session,
        current_user=USER,
    )

    assert updated.front_content == "changed"
    assert events == ["flush", "refresh", "commit"]


@pytest.mark.asyncio
async def test_create_deck_commits_before_returning() -> None:
    events: list[str] = []

    def _refresh_deck(obj, *args, **kwargs):
        events.append("refresh")
        obj.id = 1

    session = AsyncMock()
    session.add = Mock()
    session.flush.side_effect = lambda: events.append("flush")
    session.refresh.side_effect = _refresh_deck
    session.commit.side_effect = lambda: events.append("commit")

    deck = await create_deck(
        deck_data=DeckCreate(name="New deck"),
        session=session,
        current_user=USER,
    )

    assert deck.name == "New deck"
    assert deck.id == 1
    assert events == ["flush", "refresh", "commit"]


@pytest.mark.asyncio
async def test_update_deck_commits_after_stats_read() -> None:
    deck = Deck(id=1, user_id=1, name="Deck")
    events: list[str] = []
    deck_result = _one_or_none(deck)
    stats_result = Mock()
    stats_result.first.return_value = (0, 0, 0, None)
    execute_results = iter([deck_result, stats_result])

    async def fake_execute(*args, **kwargs):
        events.append("execute")
        return next(execute_results)

    session = AsyncMock()
    session.execute.side_effect = fake_execute
    session.flush.side_effect = lambda: events.append("flush")
    session.refresh.side_effect = lambda *args, **kwargs: events.append("refresh")
    session.commit.side_effect = lambda: events.append("commit")

    deck_read = await update_deck(
        deck_id=1,
        deck_data=DeckUpdate(name="Renamed"),
        session=session,
        current_user=USER,
    )

    assert deck_read.name == "Renamed"
    assert events == ["execute", "flush", "refresh", "execute", "commit"]
