"""Tests for exact-first results from indexed single-word hits."""

import app.services.card_word_search as word_search_service
from app.services.card_word_search import (
    CardWordSearchHit,
    build_word_search_results,
)


def _hit(
    card_id: int,
    front_content: str,
    front_lemma: str,
    *,
    deck_id: int = 1,
    deck_name: str = "French",
) -> CardWordSearchHit:
    return CardWordSearchHit(
        card_id=card_id,
        deck_id=deck_id,
        deck_name=deck_name,
        front_content=front_content,
        front_lemma=front_lemma,
    )


def test_results_prioritize_exact_hits_and_count_each_card_once():
    results = build_word_search_results(
        ["chevaux"],
        [
            _hit(1, "cheval", "cheval"),
            _hit(2, "chevaux", "cheval"),
        ],
    )

    result = results[0]
    assert result.has_match is True
    assert result.match_count == 2
    assert [match.card_id for match in result.matches] == [2, 1]
    assert [match.match_type for match in result.matches] == ["exact", "lemma"]
    assert [match.matched_form for match in result.matches] == ["chevaux", "cheval"]


def test_duplicate_query_words_keep_separate_results_in_input_order():
    results = build_word_search_results(
        ["cheval", "CHEVAL", "chat"],
        [_hit(1, "cheval", "cheval")],
    )

    assert [result.query for result in results] == ["cheval", "CHEVAL", "chat"]
    assert [result.has_match for result in results] == [True, True, False]


def test_results_keep_full_count_and_limit_examples_to_five():
    hits = [_hit(card_id, "cheval", "cheval") for card_id in range(1, 7)]
    result = build_word_search_results(["cheval"], hits)[0]

    assert result.match_count == 6
    assert result.matches_truncated is True
    assert len(result.matches) == 5
    assert [match.card_id for match in result.matches] == [1, 2, 3, 4, 5]


def test_exact_match_order_is_stable_by_deck_then_card_id():
    results = build_word_search_results(
        ["cheval"],
        [
            _hit(3, "cheval", "cheval", deck_id=2),
            _hit(5, "cheval", "cheval", deck_id=1),
            _hit(2, "cheval", "cheval", deck_id=1),
        ],
    )

    assert [match.card_id for match in results[0].matches] == [2, 5, 3]


def test_search_matches_do_not_include_back_content():
    result = build_word_search_results(["chat"], [_hit(1, "chat", "chat")])[0]

    assert result.matches[0].matched_form == "chat"
    assert not hasattr(result.matches[0], "back_content")


def test_repeated_queries_normalize_each_hit_surface_once(monkeypatch):
    calls = 0
    original = word_search_service.front_word_for_content

    def counted(front_content: str) -> str | None:
        nonlocal calls
        calls += 1
        return original(front_content)

    monkeypatch.setattr(word_search_service, "front_word_for_content", counted)
    hits = [_hit(card_id, "cheval", "cheval") for card_id in range(1, 4)]

    results = build_word_search_results(["cheval"] * 3, hits)

    assert calls == len(hits)
    assert [result.match_count for result in results] == [3, 3, 3]
