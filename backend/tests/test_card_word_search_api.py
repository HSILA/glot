"""Tests for the authenticated batch card-word search endpoint."""

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy.dialects.sqlite import dialect

import app.api.v1.cards as cards_api
from app.api.v1.cards import check_card_words
from app.models import Deck
from app.schemas import CardWordSearchRequest


class _MappingsResult:
    def __init__(self, rows):
        self._rows = rows

    def all(self):
        return self._rows


class _RowsResult:
    def __init__(self, rows):
        self._rows = rows

    def mappings(self):
        return _MappingsResult(self._rows)


class _ScalarsResult:
    def __init__(self, values):
        self._values = values

    def scalars(self):
        return self

    def all(self):
        return self._values


def _hit(
    card_id: int,
    front_content: str,
    front_lemma: str,
    deck_id: int = 1,
    deck_name: str = "French",
):
    return {
        "card_id": card_id,
        "deck_id": deck_id,
        "deck_name": deck_name,
        "front_content": front_content,
        "front_lemma": front_lemma,
    }


def _user(user_id: int = 7):
    return SimpleNamespace(id=user_id)


@pytest.mark.asyncio
async def test_check_words_offloads_result_building_to_worker_thread(monkeypatch):
    session = AsyncMock()
    session.execute.return_value = _RowsResult([_hit(1, "cheval", "cheval")])
    called = []

    async def run_in_thread(function, *args):
        called.append(function.__name__)
        return function(*args)

    monkeypatch.setattr(cards_api.asyncio, "to_thread", run_in_thread)

    await check_card_words(
        CardWordSearchRequest(words=["cheval"]),
        session,
        _user(),
    )

    assert called == ["build_word_search_results"]


@pytest.mark.asyncio
async def test_check_words_uses_one_owned_lemma_query_and_returns_no_back_content():
    session = AsyncMock()
    session.execute.return_value = _RowsResult(
        [
            _hit(1, "cheval", "cheval", deck_name="French A"),
            _hit(2, "mangeaient", "manger", deck_id=2, deck_name="French B"),
        ]
    )

    response = await check_card_words(
        CardWordSearchRequest(words=["chevaux", "manger"]),
        session,
        _user(),
    )

    assert session.execute.await_count == 1
    statement = session.execute.call_args.args[0]
    sql = str(statement.compile(dialect=dialect()))
    assert "cards.front_lemma IN" in sql
    assert "decks.user_id" in sql
    assert "cards.back_content" not in sql
    assert response.deck_name is None
    assert [result.has_match for result in response.results] == [True, True]
    assert [result.match_count for result in response.results] == [1, 1]
    assert [result.matches_truncated for result in response.results] == [False, False]
    assert response.results[0].matches[0].card_id == 1
    assert response.results[0].matches[0].match_type == "lemma"
    assert response.results[0].matches[0].deck_name == "French A"
    assert response.results[1].matches[0].card_id == 2
    assert not hasattr(response.results[1].matches[0], "back_content")


@pytest.mark.parametrize("query", ["prendre soin de", "cheval,chat", "**cheval**"])
def test_check_words_request_rejects_non_word_candidates(query: str):
    with pytest.raises(ValidationError, match="one word"):
        CardWordSearchRequest(words=[query])


@pytest.mark.asyncio
async def test_check_words_caps_examples_but_preserves_match_count():
    session = AsyncMock()
    session.execute.return_value = _RowsResult(
        [_hit(card_id, "cheval", "cheval") for card_id in range(1, 7)]
    )

    response = await check_card_words(
        CardWordSearchRequest(words=["cheval"]),
        session,
        _user(),
    )

    result = response.results[0]
    assert result.has_match is True
    assert result.match_count == 6
    assert result.matches_truncated is True
    assert len(result.matches) == 5


@pytest.mark.asyncio
async def test_check_words_scopes_cards_to_one_named_deck():
    session = AsyncMock()
    deck = Deck(id=4, user_id=7, name="French")
    session.execute.side_effect = [
        _ScalarsResult([deck]),
        _RowsResult([_hit(1, "cheval", "cheval", deck_id=4)]),
    ]

    response = await check_card_words(
        CardWordSearchRequest(words=["chevaux"], deck_name="French"),
        session,
        _user(),
    )

    assert session.execute.await_count == 2
    statement = session.execute.call_args.args[0]
    sql = str(statement.compile(dialect=dialect()))
    assert "decks.user_id" in sql
    assert "cards.deck_id" in sql
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
    with pytest.raises(ValidationError, match="blank"):
        CardWordSearchRequest(words=[" "])


def test_check_words_request_rejects_blank_deck_name():
    with pytest.raises(ValidationError, match="blank"):
        CardWordSearchRequest(words=["cheval"], deck_name=" ")


def test_check_words_request_rejects_oversized_terms():
    with pytest.raises(ValidationError, match="64"):
        CardWordSearchRequest(words=["a" * 65])


def test_check_words_request_rejects_text_without_a_word():
    with pytest.raises(ValidationError, match="one word"):
        CardWordSearchRequest(words=["!!!"])
