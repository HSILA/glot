"""Tests for the optional language-learning card metadata contract.

These fields live in the card's free-form ``meta_data`` JSONB, so they must be
fully optional, never required for existing cards, and pass through untouched
when provided. ``CardMetadata`` documents the recognized keys for the review UI.
"""

from app.schemas import CardCreate, CardMetadata, CardRead


def test_metadata_fields_are_all_optional():
    """An empty metadata object is valid and yields all-None known fields."""
    meta = CardMetadata()

    assert meta.phonetics is None
    assert meta.word_type is None
    assert meta.gender is None
    assert meta.example is None
    assert meta.example_translation is None


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
    assert meta.word_type == "noun"
    assert meta.gender == "masculine"
    assert meta.example == "Le chat dort."
    assert meta.example_translation == "The cat sleeps."
    assert meta.example_highlight == "chat"


def test_metadata_preserves_unrelated_keys():
    """Unrelated existing metadata (e.g. vocab readings) is never dropped."""
    meta = CardMetadata.model_validate({"reading": "ねこ", "word_type": "noun"})

    dumped = meta.model_dump()
    assert dumped["reading"] == "ねこ"
    assert dumped["word_type"] == "noun"


def test_card_create_passes_language_metadata_through():
    """The create schema carries the language fields through meta_data verbatim."""
    payload = {
        "front_content": "chat",
        "back_content": "cat",
        "deck_id": 1,
        "meta_data": {
            "phonetics": "/ʃa/",
            "word_type": "noun",
            "gender": "masculine",
        },
    }

    card = CardCreate.model_validate(payload)

    assert card.meta_data == payload["meta_data"]


def test_card_read_keeps_metadata_without_requiring_language_fields():
    """A legacy card with unrelated metadata reads back unchanged."""
    card = CardRead.model_validate(
        {
            "id": 1,
            "sequence": 1,
            "front_content": "chat",
            "back_content": "cat",
            "meta_data": {"reading": "x"},
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

    assert card.meta_data == {"reading": "x"}
