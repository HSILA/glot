"""Portable, lemma-indexed search over one-word card fronts."""

from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from typing import Literal

from sqlalchemy import Select, select

from app.core.french_word import (
    PreparedSearchWord,
    front_word_for_content,
    prepare_search_word,
)
from app.models.card import Card
from app.models.deck import Deck

WordMatchType = Literal["exact", "lemma"]
MAX_MATCHES_PER_QUERY = 5


@dataclass(frozen=True, slots=True)
class CardWordSearchHit:
    """A card returned by the indexed lemma query."""

    card_id: int
    deck_id: int
    deck_name: str
    front_content: str
    front_lemma: str


@dataclass(frozen=True, slots=True)
class CardWordMatch:
    """One single-word card matched by a candidate."""

    card_id: int
    deck_id: int
    deck_name: str
    front_content: str
    matched_form: str
    match_type: WordMatchType


@dataclass(frozen=True, slots=True)
class WordSearchResult:
    """Matches for one candidate word."""

    query: str
    normalized_query: str
    lemma: str
    match_count: int
    matches_truncated: bool
    matches: list[CardWordMatch]

    @property
    def has_match(self) -> bool:
        """Return whether at least one card matched."""
        return self.match_count > 0


def build_word_search_statement(
    lemmas: Sequence[str],
    *,
    user_id: int,
    deck_id: int | None = None,
) -> Select:
    """Build one portable SQL query for a batch of candidate lemmas."""
    statement = (
        select(
            Card.id.label("card_id"),
            Card.deck_id.label("deck_id"),
            Deck.name.label("deck_name"),
            Card.front_content.label("front_content"),
            Card.front_lemma.label("front_lemma"),
        )
        .select_from(Card)
        .join(Deck, Deck.id == Card.deck_id)
        .where(
            Card.front_lemma.in_(sorted(set(lemmas))),
            Deck.user_id == user_id,
        )
        .order_by(Card.deck_id.asc(), Card.id.asc())
    )
    if deck_id is not None:
        statement = statement.where(Card.deck_id == deck_id)
    return statement


def build_word_search_results(
    words: Sequence[str | PreparedSearchWord],
    hits: Iterable[CardWordSearchHit],
) -> list[WordSearchResult]:
    """Group indexed SQL hits into ordered, exact-first result entries."""
    prepared_words = [
        word if isinstance(word, PreparedSearchWord) else prepare_search_word(word)
        for word in words
    ]
    hits_by_lemma: dict[str, list[tuple[CardWordSearchHit, str]]] = {}
    for hit in hits:
        surface = front_word_for_content(hit.front_content)
        if surface is not None:
            hits_by_lemma.setdefault(hit.front_lemma, []).append((hit, surface))

    hits_by_surface: dict[str, dict[str, list[tuple[CardWordSearchHit, str]]]] = {}
    for lemma, lemma_hits in hits_by_lemma.items():
        lemma_hits.sort(key=lambda entry: (entry[0].deck_id, entry[0].card_id))
        surfaces: dict[str, list[tuple[CardWordSearchHit, str]]] = {}
        for entry in lemma_hits:
            surfaces.setdefault(entry[1], []).append(entry)
        hits_by_surface[lemma] = surfaces

    results: list[WordSearchResult] = []
    for word in prepared_words:
        lemma_hits = hits_by_lemma.get(word.lemma, ())
        exact_hits = hits_by_surface.get(word.lemma, {}).get(word.normalized_query, ())
        selected: list[tuple[CardWordSearchHit, str, WordMatchType]] = [
            (hit, surface, "exact")
            for hit, surface in exact_hits[:MAX_MATCHES_PER_QUERY]
        ]
        if len(selected) < MAX_MATCHES_PER_QUERY:
            for hit, surface in lemma_hits:
                if surface == word.normalized_query:
                    continue
                selected.append((hit, surface, "lemma"))
                if len(selected) == MAX_MATCHES_PER_QUERY:
                    break

        matches = [
            CardWordMatch(
                card_id=hit.card_id,
                deck_id=hit.deck_id,
                deck_name=hit.deck_name,
                front_content=hit.front_content,
                matched_form=surface,
                match_type=match_type,
            )
            for hit, surface, match_type in selected
        ]
        match_count = len(lemma_hits)
        results.append(
            WordSearchResult(
                query=word.query,
                normalized_query=word.normalized_query,
                lemma=word.lemma,
                match_count=match_count,
                matches_truncated=match_count > MAX_MATCHES_PER_QUERY,
                matches=matches,
            )
        )
    return results
