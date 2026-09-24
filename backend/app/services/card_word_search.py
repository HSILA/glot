"""Portable word and phrase matching for existing flashcard front content."""

import re
import unicodedata
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from typing import Literal

import simplemma

WordMatchType = Literal["exact", "lemma"]
MAX_MATCHES_PER_QUERY = 5


@dataclass(frozen=True, slots=True)
class CardWordSearchCard:
    """The card fields needed by the word-search response."""

    id: int
    deck_id: int
    deck_name: str
    front_content: str
    back_content: str


@dataclass(frozen=True, slots=True)
class CardWordSearchToken:
    """One normalized front-content token and its French lemma."""

    surface: str
    lemma: str


@dataclass(frozen=True, slots=True)
class CardWordMatch:
    """One existing card matched by a query word or phrase."""

    card: CardWordSearchCard
    matched_form: str
    match_type: WordMatchType


@dataclass(frozen=True, slots=True)
class WordSearchResult:
    """Matches for one query word or phrase."""

    query: str
    normalized_query: str
    lemma: str
    match_count: int
    matches_truncated: bool
    matches: list[CardWordMatch]


# simplemma tokenizes text but leaves Markdown markers attached to nearby words.
# Extracting Unicode words here keeps the matcher independent of the database and
# removes punctuation without attempting full Markdown parsing.
_WORD_PATTERN = re.compile(r"[^\W_]+(?:['’\-][^\W_]+)*", re.UNICODE)


def normalize_word(value: str) -> str:
    """Normalize one word for portable equality comparisons."""
    return unicodedata.normalize("NFC", value).strip().lower()


def lemma_for_word(value: str) -> str:
    """Return the French lemma for one normalized word."""
    return simplemma.lemmatize(
        normalize_word(value),
        lang="fr",
        greedy=False,
    )


def _tokenize(value: str) -> tuple[str, ...]:
    """Return normalized word tokens from text in their original order."""
    normalized_text = unicodedata.normalize("NFC", value)
    tokens: list[str] = []
    for token in simplemma.simple_tokenizer(normalized_text):
        for word in _WORD_PATTERN.findall(token):
            normalized = normalize_word(word)
            if normalized:
                tokens.append(normalized)
    return tuple(tokens)


def _front_tokens(front_content: str) -> tuple[CardWordSearchToken, ...]:
    """Return normalized front tokens with their French lemmas."""
    return tuple(
        CardWordSearchToken(surface=surface, lemma=lemma_for_word(surface))
        for surface in _tokenize(front_content)
    )


def _find_sequence(
    tokens: Sequence[CardWordSearchToken],
    query: Sequence[str],
    attribute: Literal["surface", "lemma"],
) -> int | None:
    """Find a contiguous query sequence and return its first token index."""
    query_length = len(query)
    if not query_length or query_length > len(tokens):
        return None

    for start in range(len(tokens) - query_length + 1):
        if tuple(
            getattr(token, attribute) for token in tokens[start : start + query_length]
        ) == tuple(query):
            return start
    return None


def _matched_form(
    tokens: Sequence[CardWordSearchToken],
    start: int,
    length: int,
) -> str:
    """Return the normalized surface form for a matched token sequence."""
    return " ".join(token.surface for token in tokens[start : start + length])


def find_word_matches(
    words: Sequence[str],
    cards: Iterable[CardWordSearchCard],
) -> list[WordSearchResult]:
    """Match query words or phrases against supplied card fronts.

    Exact normalized sequences take priority over French lemma sequences. Both
    kinds of matches must be contiguous and preserve token order. The function
    performs no database or database-specific work.
    """
    indexed_cards = [(card, _front_tokens(card.front_content)) for card in cards]

    results: list[WordSearchResult] = []
    for query in words:
        query_tokens = _tokenize(query)
        query_lemmas = tuple(lemma_for_word(token) for token in query_tokens)
        normalized_query = " ".join(query_tokens)
        query_lemma = " ".join(query_lemmas)
        exact_matches: list[CardWordMatch] = []
        lemma_matches: list[CardWordMatch] = []
        exact_count = 0
        lemma_count = 0

        for card, tokens in indexed_cards:
            exact_start = _find_sequence(tokens, query_tokens, "surface")
            if exact_start is not None:
                exact_count += 1
                if len(exact_matches) < MAX_MATCHES_PER_QUERY:
                    exact_matches.append(
                        CardWordMatch(
                            card=card,
                            matched_form=_matched_form(
                                tokens,
                                exact_start,
                                len(query_tokens),
                            ),
                            match_type="exact",
                        )
                    )
                continue

            lemma_start = _find_sequence(tokens, query_lemmas, "lemma")
            if lemma_start is not None:
                lemma_count += 1
                if len(lemma_matches) < MAX_MATCHES_PER_QUERY:
                    lemma_matches.append(
                        CardWordMatch(
                            card=card,
                            matched_form=_matched_form(
                                tokens,
                                lemma_start,
                                len(query_tokens),
                            ),
                            match_type="lemma",
                        )
                    )

        match_count = exact_count + lemma_count
        matches = (
            exact_matches
            + lemma_matches[: max(0, MAX_MATCHES_PER_QUERY - len(exact_matches))]
        )
        results.append(
            WordSearchResult(
                query=query,
                normalized_query=normalized_query,
                lemma=query_lemma,
                match_count=match_count,
                matches_truncated=match_count > MAX_MATCHES_PER_QUERY,
                matches=matches,
            )
        )

    return results
