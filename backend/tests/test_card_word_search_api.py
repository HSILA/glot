"""Tests for the authenticated batch card-word search endpoint."""

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

from app.api.v1.cards import check_card_words
from app.models import Card, Deck
from app.schemas import CardWordSearchRequest


class _RowsResult:
    def __init__(self, rows):
        self._rows = rows

    def all(self):
        return self._rows


class _ScalarsResult:
    def __init__(self, values):
        self._values = values

    def scalars(self):
        return self

    def all(self):
        return self._values


def _card(card_id: int, front_content: str, deck_id: int = 1) -> Card:
    return Card(
        id=card_id,
        sequence=card_id,
        deck_id=deck_id,
        front_content=front_content,
        back_content="translation",
    )


def _user(user_id: int = 7):
    return SimpleNamespace(id=user_id)


@pytest.mark.asyncio
async def test_check_words_loads_all_owned_cards_in_one_batch_query():
    session = AsyncMock()
    session.execute.return_value = _RowsResult(
        [
            (_card(1, "le cheval", deck_id=1), "French A"),
            (_card(2, "mangeaient", deck_id=2), "French B"),
        ]
    )

    response = await check_card_words(
        CardWordSearchRequest(words=["chevaux", "manger"]),
        session,
        _user(),
    )

    assert session.execute.await_count == 1
    assert response.deck_name is None
    assert [result.has_match for result in response.results] == [True, True]
    assert response.results[0].matches[0].card_id == 1
    assert response.results[0].matches[0].deck_name == "French A"
    assert response.results[1].matches[0].card_id == 2


@pytest.mark.asyncio
async def test_check_words_scopes_cards_to_one_named_deck():
    session = AsyncMock()
    deck = Deck(id=4, user_id=7, name="French")
    session.execute.side_effect = [
        _ScalarsResult([deck]),
        _RowsResult([(_card(1, "cheval", deck_id=4), "French")]),
    ]

    response = await check_card_words(
        CardWordSearchRequest(words=["chevaux"], deck_name="French"),
        session,
        _user(),
    )

    assert session.execute.await_count == 2
    assert response.deck_name == "French"
    assert response.results[0].has_match is True
    assert response.results[0].matches[0].deck_id == 4


@pytest.mark.asyncio
async def test_check_words_rejects_ambiguous_deck_name():
    session = AsyncMock()
    session.execute.return_value = _ScalarsResult(
        [
            Deck(id=4, user_id=7, name="French"),
            Deck(id=5, user_id=7, name="French"),
        ]
    )

    with pytest.raises(HTTPException) as exc_info:
        await check_card_words(
            CardWordSearchRequest(words=["cheval"], deck_name="French"),
            session,
            _user(),
        )

    assert exc_info.value.status_code == 409
    assert session.execute.await_count == 1


@pytest.mark.asyncio
async def test_check_words_returns_not_found_for_unknown_deck_name():
    session = AsyncMock()
    session.execute.return_value = _ScalarsResult([])

    with pytest.raises(HTTPException) as exc_info:
        await check_card_words(
            CardWordSearchRequest(words=["cheval"], deck_name="Missing"),
            session,
            _user(),
        )

    assert exc_info.value.status_code == 404
    assert session.execute.await_count == 1


def test_check_words_request_rejects_blank_values():
    with pytest.raises(ValueError, match="blank"):
        CardWordSearchRequest(words=[" "])


def test_check_words_request_rejects_blank_deck_name():
    with pytest.raises(ValueError, match="blank"):
        CardWordSearchRequest(words=["cheval"], deck_name=" ")
