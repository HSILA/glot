"""Portable word matching for existing flashcard front content."""

import re
import unicodedata
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from typing import Literal

import simplemma

WordMatchType = Literal["exact", "lemma"]


@dataclass(frozen=True, slots=True)
class CardWordSearchCard:
    """The card fields needed by the word-search response."""

    id: int
    deck_id: int
    deck_name: str
    front_content: str
    back_content: str


@dataclass(frozen=True, slots=True)
class CardWordMatch:
    """One existing card matched by a query word."""

    card: CardWordSearchCard
    matched_form: str
    match_type: WordMatchType


@dataclass(frozen=True, slots=True)
class WordSearchResult:
    """Matches for one query word."""

    query: str
    normalized_query: str
    lemma: str
    matches: list[CardWordMatch]


# simplemma tokenizes text but leaves Markdown markers attached to nearby words.
# Extracting Unicode words here keeps the matcher independent of the database and
# removes punctuation without attempting full Markdown parsing.
_WORD_PATTERN = re.compile(r"[^\W_]+(?:['’\-][^\W_]+)*", re.UNICODE)


def normalize_word(value: str) -> str:
    """Normalize a word for portable equality comparisons."""
    return unicodedata.normalize("NFKC", value).strip().casefold()


def lemma_for_word(value: str) -> str:
    """Return the French lemma for a normalized word."""
    return simplemma.lemmatize(normalize_word(value), lang="fr")


def _front_words(front_content: str) -> Iterable[str]:
    """Yield normalized word forms found in card front content."""
    for token in simplemma.simple_tokenizer(front_content):
        for word in _WORD_PATTERN.findall(token):
            normalized = normalize_word(word)
            if normalized:
                yield normalized


def find_word_matches(
    words: Sequence[str],
    cards: Iterable[CardWordSearchCard],
) -> list[WordSearchResult]:
    """Match query words against all words in the supplied card fronts.

    Exact normalized matches take priority over lemma matches for each card.
    The function performs no database or database-specific work.
    """
    indexed_cards = [
        (
            card,
            tuple(
                (surface, lemma_for_word(surface))
                for surface in _front_words(card.front_content)
            ),
        )
        for card in cards
    ]

    results: list[WordSearchResult] = []
    for query in words:
        normalized_query = normalize_word(query)
        query_lemma = lemma_for_word(normalized_query)
        exact_matches: list[CardWordMatch] = []
        lemma_matches: list[CardWordMatch] = []

        for card, tokens in indexed_cards:
            exact_form = next(
                (surface for surface, _lemma in tokens if surface == normalized_query),
                None,
            )
            if exact_form is not None:
                exact_matches.append(
                    CardWordMatch(
                        card=card,
                        matched_form=exact_form,
                        match_type="exact",
                    )
                )
                continue

            lemma_form = next(
                (
                    surface
                    for surface, token_lemma in tokens
                    if token_lemma == query_lemma
                ),
                None,
            )
            if lemma_form is not None:
                lemma_matches.append(
                    CardWordMatch(
                        card=card,
                        matched_form=lemma_form,
                        match_type="lemma",
                    )
                )

        matches = exact_matches + lemma_matches
        results.append(
            WordSearchResult(
                query=query,
                normalized_query=normalized_query,
                lemma=query_lemma,
                matches=matches,
            )
        )

    return results
