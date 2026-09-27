"""Regression tests for issue #116: write endpoints must commit before responding.

The session dependency commits in post-response teardown, so a failed commit
used to leave the client with a success response while the change rolled back
(an undetected phantom success). Write endpoints now commit explicitly before
they return.
"""

from unittest.mock import AsyncMock, Mock

import pytest
from fastapi import HTTPException

from app.api.v1.cards import delete_card
from app.api.v1.decks import delete_deck
from app.api.v1.resources import delete_resource
from app.models import Card, Deck, Resource, User, UserResource

USER = User(id=1, email="user@example.com", password_hash="hash")


def _one_or_none(value):
    result = Mock()
    result.scalar_one_or_none.return_value = value
    return result


def _scalar(value):
    result = Mock()
    result.scalar.return_value = value
    return result


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
    resource = Resource(
        id=1,
        content_hash="a" * 64,
        size_bytes=10,
        file_name="document.pdf",
        uploaded_by=1,
        upload_confirmed=True,
    )
    link = UserResource(user_id=1, resource_id=1, name="Document")
    session = AsyncMock()
    session.get.return_value = resource
    session.execute.side_effect = [_one_or_none(link), _scalar(0)]
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
    assert events and events[0] == "commit"
    assert "storage" in events
