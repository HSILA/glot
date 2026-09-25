"""Shared French single-word rules for card search."""

import re
import unicodedata
from dataclasses import dataclass

import simplemma

MAX_CARD_WORD_QUERY_LENGTH = 64
MAX_STORED_FRONT_WORD_LENGTH = 255
_SINGLE_WORD_PATTERN = re.compile(r"[^\W_]+", re.UNICODE)


@dataclass(frozen=True, slots=True)
class PreparedSearchWord:
    """One normalized request word and its French lemma."""

    query: str
    normalized_query: str
    lemma: str


def normalize_word(value: str) -> str:
    """Apply NFC composition and lowercase normalization."""
    composed = unicodedata.normalize("NFC", value).strip()
    return unicodedata.normalize("NFC", composed.lower())


def single_word_surface(value: str) -> str | None:
    """Return a normalized plain word only when the whole value is one word."""
    normalized = normalize_word(value)
    if not normalized or _SINGLE_WORD_PATTERN.fullmatch(normalized) is None:
        return None
    return normalized


def front_word_for_content(front_content: str) -> str | None:
    """Return the searchable surface for one plain-word card front."""
    surface = single_word_surface(front_content)
    if surface is None or len(surface) > MAX_STORED_FRONT_WORD_LENGTH:
        return None
    return surface


def lemma_for_word(value: str) -> str:
    """Return the French lemma for one word."""
    return simplemma.lemmatize(normalize_word(value), lang="fr", greedy=False)


def front_lemma_for_content(front_content: str) -> str | None:
    """Return a lemma only when the complete front is one plain word."""
    surface = front_word_for_content(front_content)
    if surface is None:
        return None
    lemma = lemma_for_word(surface)
    if len(lemma) > MAX_STORED_FRONT_WORD_LENGTH:
        return None
    return lemma


def normalize_search_word(value: str) -> str:
    """Validate and normalize a query without calculating its lemma."""
    if not value.strip():
        raise ValueError("words must not contain blank values")
    if len(value) > MAX_CARD_WORD_QUERY_LENGTH:
        raise ValueError(
            f"each word must be at most {MAX_CARD_WORD_QUERY_LENGTH} characters"
        )
    surface = single_word_surface(value)
    if surface is None:
        raise ValueError("each candidate must be one word")
    if len(surface) > MAX_CARD_WORD_QUERY_LENGTH:
        raise ValueError(
            f"each normalized word must be at most {MAX_CARD_WORD_QUERY_LENGTH} characters"
        )
    return surface


def prepare_search_word(value: str) -> PreparedSearchWord:
    """Normalize and lemmatize one bounded plain-word query."""
    surface = normalize_search_word(value)
    lemma = lemma_for_word(surface)
    if len(lemma) > MAX_CARD_WORD_QUERY_LENGTH:
        raise ValueError(
            f"each word lemma must be at most {MAX_CARD_WORD_QUERY_LENGTH} characters"
        )
    return PreparedSearchWord(query=value, normalized_query=surface, lemma=lemma)
