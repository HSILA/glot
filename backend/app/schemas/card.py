"""
Card schemas for API request/response validation.
"""

from datetime import datetime
from enum import StrEnum
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.core.french_word import normalize_search_word
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
    # Incremented on every recorded review; clients echo it back so a stale
    # submission from another device is rejected instead of overwriting
    # newer scheduling.
    review_version: int

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


class DueSummary(BaseModel):
    """Study-eligible counts for one scope (all decks, or one deck).

    ``total`` is the number the session header displays; it must equal the
    dashboard's "cards to study" number for the same scope. The breakdown is
    the dashboard's "due" and "new" chips.
    """

    scheduled_due_count: int = Field(ge=0)
    new_count: int = Field(ge=0)
    total: int = Field(ge=0)
    as_of: datetime
    deck_id: int | None = Field(
        default=None, description="Scope: one deck, or all decks when omitted"
    )


class DueBatchResponse(BaseModel):
    """A batch of due cards plus the scope counts from the same snapshot.

    ``items`` is one page of the study queue; the client keeps fetching until
    it is empty. Because items and counts come from one SQL snapshot, an empty
    ``items`` with ``total == 0`` is the only truthful "all caught up" signal.
    """

    items: list[CardRead]
    summary: DueSummary
    limit: int


class CardWordSearchRequest(BaseModel):
    """Single words to check against existing one-word card fronts."""

    words: list[str] = Field(
        min_length=1,
        max_length=100,
        description="Single-word candidates to check, in request order",
    )
    deck_name: str | None = Field(
        default=None,
        min_length=1,
        max_length=255,
        description="Optional owned deck name to scope the search",
    )

    @field_validator("words")
    @classmethod
    def validate_words(cls, value: list[str]) -> list[str]:
        """Reject blank, phrase, Markdown, or oversized candidate words."""
        for word in value:
            normalize_search_word(word)
        return value

    @field_validator("deck_name")
    @classmethod
    def validate_deck_name(cls, value: str | None) -> str | None:
        """Reject a deck scope containing only whitespace."""
        if value is not None and not value.strip():
            raise ValueError("deck_name must not be blank")
        return value


class CardWordSearchMatch(BaseModel):
    """One existing single-word card matched by a candidate."""

    card_id: int
    deck_id: int
    deck_name: str
    front_content: str
    matched_form: str
    match_type: Literal["exact", "lemma"]


class CardWordSearchResult(BaseModel):
    """Matches for one candidate word."""

    query: str
    normalized_query: str
    lemma: str
    has_match: bool
    match_count: int = Field(ge=0)
    matches_truncated: bool
    matches: list[CardWordSearchMatch] = Field(max_length=5)


class CardWordSearchResponse(BaseModel):
    """Batch word-search response."""

    deck_name: str | None
    results: list[CardWordSearchResult]


class ReviewRequest(BaseModel):
    """Request schema for reviewing a card."""

    rating: int = Field(ge=1, le=4, description="1=Again, 2=Hard, 3=Good, 4=Easy")
    review_duration_ms: int | None = Field(
        default=None, ge=0, description="Time taken to answer in milliseconds"
    )
    request_id: UUID | None = Field(
        default=None,
        description="Client-generated idempotency key. A retry with the same "
        "key returns the recorded result instead of applying the rating twice.",
    )
    expected_review_version: int | None = Field(
        default=None,
        ge=0,
        description="card.review_version the client saw when the card was "
        "loaded; a mismatch means another device reviewed the card first (409).",
    )
    scope_deck_id: int | None = Field(
        default=None,
        description="Deck scope for the returned due summary (the session's "
        "deck mode); omit for all-decks scope.",
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
    """Response after reviewing a card.

    ``replayed`` is true when the response was answered from the stored
    receipt of an earlier submission with the same ``request_id`` (the rating
    was not applied again). ``summary`` carries fresh scope counts so the
    session header stays truthful after every acknowledged rating.
    """

    card: CardRead
    next_states: NextStatesResponse
    message: str = "Review recorded successfully"
    request_id: UUID | None = None
    review_id: int | None = None
    replayed: bool = False
    summary: DueSummary | None = None
