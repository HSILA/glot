"""
Card schemas for API request/response validation.
"""

from datetime import datetime
from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field

from app.models.card import CardState


class WordType(StrEnum):
    """Recognized parts of speech for a card's ``word_type`` metadata."""

    NOUN = "noun"
    VERB = "verb"
    ADJECTIVE = "adjective"
    ADVERB = "adverb"
    PRONOUN = "pronoun"
    PREPOSITION = "preposition"
    CONJUNCTION = "conjunction"
    INTERJECTION = "interjection"
    DETERMINER = "determiner"
    PARTICLE = "particle"


class Gender(StrEnum):
    """Recognized grammatical genders for a card's ``gender`` metadata."""

    MASCULINE = "masculine"
    FEMININE = "feminine"
    NEUTER = "neuter"


class CardMetadata(BaseModel):
    """Recognized optional language-learning fields inside a card's ``meta_data``.

    These live in the card's free-form ``meta_data`` JSONB (the established
    "type-specific fields" plumbing), so they are entirely optional and never
    required for existing cards. This model documents the recognized keys so the
    review UI can receive and display them cleanly when provided.

    ``extra="allow"`` preserves any other metadata keys already stored on a card
    (e.g. vocab readings) so typing these fields never drops unrelated data.
    """

    model_config = ConfigDict(extra="allow")

    phonetics: str | None = Field(
        default=None, description="Pronunciation / phonetic transcription (e.g. IPA)"
    )
    word_type: WordType | None = Field(
        default=None,
        description="Part of speech (noun, verb, adjective, adverb, pronoun, "
        "preposition, conjunction, interjection, determiner, particle)",
    )
    gender: Gender | None = Field(
        default=None,
        description="Grammatical gender (masculine, feminine, neuter)",
    )
    example: str | None = Field(
        default=None, description="Example sentence using the word/phrase"
    )
    example_translation: str | None = Field(
        default=None, description="Translation of the example sentence"
    )
    example_highlight: str | None = Field(
        default=None,
        description="Substring of the example to emphasize (usually the target word)",
    )


class CardCreate(BaseModel):
    """Schema for creating a new card."""

    front_content: str = Field(min_length=1, max_length=10000)
    back_content: str = Field(min_length=1, max_length=10000)
    # Free-form metadata; optional language-learning fields (phonetics,
    # word_type, gender, example, example_translation, example_highlight) are
    # documented and validated by CardMetadata. Unrecognized keys are preserved.
    meta_data: CardMetadata = Field(default_factory=CardMetadata)
    tags: list[str] = Field(default_factory=list)
    deck_id: int = Field(description="Deck this card belongs to")


class CardUpdate(BaseModel):
    """Schema for updating an existing card."""

    front_content: str | None = Field(default=None, min_length=1, max_length=10000)
    back_content: str | None = Field(default=None, min_length=1, max_length=10000)
    # Optional: send to replace metadata (validated by CardMetadata); send null
    # to clear it. Omit to leave existing metadata untouched.
    meta_data: CardMetadata | None = None
    tags: list[str] | None = None
    deck_id: int | None = None


class CardRead(BaseModel):
    """Schema for reading a card (response)."""

    id: int
    sequence: int

    front_content: str
    back_content: str
    # CardMetadata documents the recognized optional language-learning keys the
    # review UI displays (all optional; other keys are preserved as-is).
    meta_data: CardMetadata
    tags: list[str]
    deck_id: int | None

    # Scheduling fields
    difficulty: float
    stability: float
    state: CardState
    reps: int
    lapses: int

    # Timestamps
    last_review_at: datetime | None
    next_review_at: datetime | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class CardListResponse(BaseModel):
    """Paginated card list response."""

    items: list[CardRead]
    total: int
    limit: int
    offset: int


class ReviewRequest(BaseModel):
    """Request schema for reviewing a card."""

    rating: int = Field(ge=1, le=4, description="1=Again, 2=Hard, 3=Good, 4=Easy")
    review_duration_ms: int | None = Field(
        default=None, ge=0, description="Time taken to answer in milliseconds"
    )


class SchedulingInfo(BaseModel):
    """Scheduling info for a single rating option."""

    interval_days: float
    new_difficulty: float
    new_stability: float


class NextStatesResponse(BaseModel):
    """Response showing next intervals for each rating option."""

    again: SchedulingInfo
    hard: SchedulingInfo
    good: SchedulingInfo
    easy: SchedulingInfo


class ReviewResponse(BaseModel):
    """Response after reviewing a card."""

    card: CardRead
    next_states: NextStatesResponse
    message: str = "Review recorded successfully"
