"""Single-word front eligibility and query preparation tests."""

import pytest
from sqlalchemy import inspect
from sqlalchemy.orm.attributes import set_committed_value

from app.core.french_word import (
    front_lemma_for_content,
    front_word_for_content,
    normalize_search_word,
    prepare_search_word,
)
from app.models import Card


@pytest.mark.parametrize(
    ("front", "expected_lemma"),
    [
        ("manger", "manger"),
        ("MANGEAIENT", "manger"),
        ("  CHEVAUX  ", "cheval"),
        ("école", "école"),
    ],
)
def test_plain_single_word_front_gets_a_lemma(front: str, expected_lemma: str):
    assert front_lemma_for_content(front) == expected_lemma


def test_single_word_front_normalizes_to_one_surface_word():
    assert front_word_for_content("  CHEVAUX  ") == "chevaux"


@pytest.mark.parametrize(
    "front",
    [
        "prendre soin de",
        "**manger**",
        "manger.",
        "cheval,chat",
        "l'amour",
        "porte-monnaie",
        "",
    ],
)
def test_phrase_markdown_and_punctuation_fronts_are_not_indexed(front: str):
    assert front_word_for_content(front) is None
    assert front_lemma_for_content(front) is None


def test_query_word_is_normalized_and_lemmatized():
    query = prepare_search_word("MANGEAIENT")

    assert query.query == "MANGEAIENT"
    assert query.normalized_query == "mangeaient"
    assert query.lemma == "manger"


def test_query_validation_normalizes_without_lemmatizing():
    assert normalize_search_word(" MANGEAIENT ") == "mangeaient"


@pytest.mark.parametrize(
    "query",
    ["prendre soin", "cheval,chat", "**cheval**", "l'amour", "porte-monnaie"],
)
def test_query_rejects_phrase_or_markdown(query: str):
    with pytest.raises(ValueError, match="one word"):
        prepare_search_word(query)


def test_query_rejects_oversized_word():
    with pytest.raises(ValueError, match="64"):
        prepare_search_word("a" * 65)


def test_card_insert_event_sets_the_derived_lemma():
    card = Card(
        sequence=1,
        deck_id=1,
        front_content="mangeaient",
        back_content="they ate",
    )

    Card.__mapper__.dispatch.before_insert(Card.__mapper__, None, inspect(card))

    assert card.front_lemma == "manger"


def test_card_front_update_event_recomputes_or_clears_lemma():
    card = Card(
        sequence=1,
        deck_id=1,
        front_content="manger",
        front_lemma="manger",
        back_content="to eat",
    )
    set_committed_value(card, "front_content", "manger")
    set_committed_value(card, "front_lemma", "manger")
    card.front_content = "prendre soin"

    Card.__mapper__.dispatch.before_update(Card.__mapper__, None, inspect(card))

    assert card.front_lemma is None


def test_card_back_update_does_not_recompute_front_lemma():
    card = Card(
        sequence=1,
        deck_id=1,
        front_content="manger",
        front_lemma="manger",
        back_content="to eat",
    )
    set_committed_value(card, "front_content", "manger")
    set_committed_value(card, "front_lemma", "manger")
    set_committed_value(card, "back_content", "to eat")
    card.back_content = "eat"

    Card.__mapper__.dispatch.before_update(Card.__mapper__, None, inspect(card))

    assert card.front_lemma == "manger"
