"""Tests for the optional language-learning card metadata contract.

These fields live in the card's free-form ``meta_data`` JSONB, so they must be
fully optional, never required for existing cards, and pass through untouched
when provided. ``CardMetadata`` documents and validates the recognized keys for
the review UI; ``gender`` and ``word_type`` are constrained to known enums.
"""

import pytest
from pydantic import ValidationError

from app.schemas import CardCreate, CardMetadata, CardRead, Gender, WordType


def _stored_meta(card: CardCreate) -> dict:
    """The JSONB the create endpoint persists for a card's metadata."""
    return card.meta_data.model_dump(mode="json", exclude_none=True)


def _read_with_meta(meta: dict) -> CardRead:
    """Build a CardRead around a stored ``meta_data`` bag (other fields fixed)."""
    return CardRead.model_validate(
        {
            "id": 1,
            "sequence": 1,
            "front_content": "chat",
            "back_content": "cat",
            "meta_data": meta,
            "tags": [],
            "deck_id": 1,
            "difficulty": 5.0,
            "stability": 0.0,
            "state": "new",
            "reps": 0,
            "lapses": 0,
            "last_review_at": None,
            "next_review_at": None,
            "created_at": "2025-01-01T00:00:00Z",
            "updated_at": "2025-01-01T00:00:00Z",
        }
    )


def test_metadata_fields_are_all_optional():
    """An empty metadata object is valid and yields all-None known fields."""
    meta = CardMetadata()

    assert meta.phonetics is None
    assert meta.word_type is None
    assert meta.gender is None
    assert meta.example is None
    assert meta.example_translation is None
    assert meta.example_highlight is None


def test_metadata_accepts_language_fields():
    meta = CardMetadata.model_validate(
        {
            "phonetics": "/ʃa/",
            "word_type": "noun",
            "gender": "masculine",
            "example": "Le chat dort.",
            "example_translation": "The cat sleeps.",
            "example_highlight": "chat",
        }
    )

    assert meta.phonetics == "/ʃa/"
    assert meta.word_type is WordType.NOUN
    assert meta.gender is Gender.MASCULINE
    assert meta.example == "Le chat dort."
    assert meta.example_translation == "The cat sleeps."
    assert meta.example_highlight == "chat"


def test_metadata_preserves_unrelated_keys():
    """Unrelated existing metadata (e.g. vocab readings) is never dropped."""
    meta = CardMetadata.model_validate({"reading": "ねこ", "word_type": "noun"})

    dumped = meta.model_dump(mode="json")
    assert dumped["reading"] == "ねこ"
    assert dumped["word_type"] == "noun"


@pytest.mark.parametrize(
    "gender, word_type",
    [(g.value, w.value) for g in Gender for w in (WordType.NOUN, WordType.VERB)],
)
def test_every_enum_value_is_accepted(gender, word_type):
    meta = CardMetadata.model_validate({"gender": gender, "word_type": word_type})
    assert meta.gender == gender
    assert meta.word_type == word_type


@pytest.mark.parametrize(
    "bad_meta",
    [
        {"gender": 42},  # wrong type
        {"gender": "common"},  # outside the enum
        {"gender": "m"},  # abbreviation no longer accepted
        {"word_type": "gerund"},  # outside the enum
        {"word_type": 7},  # wrong type
    ],
)
def test_invalid_enum_values_are_rejected(bad_meta):
    with pytest.raises(ValidationError):
        CardMetadata.model_validate(bad_meta)
    # ...and the same payload is rejected at the create-request boundary.
    with pytest.raises(ValidationError):
        CardCreate.model_validate(
            {
                "front_content": "chat",
                "back_content": "cat",
                "deck_id": 1,
                "meta_data": bad_meta,
            }
        )


def test_language_metadata_round_trips_through_create_and_read():
    """Recognized fields survive create -> stored JSONB -> read unchanged."""
    meta_in = {
        "phonetics": "/ʃa/",
        "word_type": "noun",
        "gender": "masculine",
        "example": "Le chat dort.",
        "example_translation": "The cat sleeps.",
        "example_highlight": "chat",
    }

    create = CardCreate.model_validate(
        {
            "front_content": "chat",
            "back_content": "cat",
            "deck_id": 1,
            "meta_data": meta_in,
        }
    )

    # The endpoint persists plain strings (enums serialized) with no None-noise.
    stored = _stored_meta(create)
    assert stored == meta_in

    card = _read_with_meta(stored)
    assert card.meta_data.phonetics == "/ʃa/"
    assert card.meta_data.word_type is WordType.NOUN
    assert card.meta_data.gender is Gender.MASCULINE
    assert card.meta_data.example == "Le chat dort."
    assert card.meta_data.example_translation == "The cat sleeps."
    assert card.meta_data.example_highlight == "chat"


def test_legacy_metadata_round_trips_through_create_and_read():
    """A card with only unrelated keys keeps them and adds no known-field noise."""
    create = CardCreate.model_validate(
        {
            "front_content": "猫",
            "back_content": "cat",
            "deck_id": 1,
            "meta_data": {"reading": "ねこ"},
        }
    )

    stored = _stored_meta(create)
    assert stored == {"reading": "ねこ"}

    card = _read_with_meta(stored)
    assert card.meta_data.model_dump(mode="json")["reading"] == "ねこ"
    assert card.meta_data.gender is None
    assert card.meta_data.word_type is None


def test_card_read_keeps_metadata_without_requiring_language_fields():
    """A legacy card with unrelated metadata reads back unchanged."""
    card = _read_with_meta({"reading": "x"})

    dumped = card.meta_data.model_dump(mode="json", exclude_none=True)
    assert dumped == {"reading": "x"}
