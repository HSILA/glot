"""Tests for portable card-word normalization and matching."""

from app.services.card_word_search import (
    CardWordSearchCard,
    find_word_matches,
    lemma_for_word,
    normalize_word,
)


def _card(
    card_id: int,
    front_content: str,
    *,
    deck_id: int = 1,
    deck_name: str = "French",
    back_content: str = "translation",
) -> CardWordSearchCard:
    return CardWordSearchCard(
        id=card_id,
        deck_id=deck_id,
        deck_name=deck_name,
        front_content=front_content,
        back_content=back_content,
    )


def test_normalization_is_case_insensitive_and_lemma_handles_inflection():
    assert normalize_word("  CHEVAUX ") == "chevaux"
    assert lemma_for_word("CHEVAUX") == "cheval"
    assert lemma_for_word("mangeaient") == "manger"


def test_plural_and_conjugated_forms_match_by_lemma():
    results = find_word_matches(
        ["chevaux", "manger"],
        [_card(1, "Les cheval"), _card(2, "Ils mangeaient")],
    )

    assert [result.query for result in results] == ["chevaux", "manger"]
    assert results[0].matches[0].match_type == "lemma"
    assert results[0].matches[0].matched_form == "cheval"
    assert results[1].matches[0].match_type == "lemma"
    assert results[1].matches[0].matched_form == "mangeaient"


def test_exact_normalized_match_is_reported_as_exact():
    results = find_word_matches(["CHEVAUX"], [_card(1, "chevaux")])

    assert results[0].matches[0].match_type == "exact"
    assert results[0].matches[0].matched_form == "chevaux"


def test_exact_match_has_priority_over_lemma_match_for_a_card():
    results = find_word_matches(["chevaux"], [_card(1, "chevaux cheval")])

    assert len(results[0].matches) == 1
    assert results[0].matches[0].match_type == "exact"
    assert results[0].matches[0].matched_form == "chevaux"


def test_matching_uses_front_content_not_translation():
    results = find_word_matches(
        ["cat"],
        [_card(1, "chat", back_content="cat")],
    )

    assert results[0].matches == []


def test_markdown_and_punctuation_do_not_block_word_matching():
    results = find_word_matches(["cheval"], [_card(1, "**Les chevaux**, ici.")])

    assert results[0].matches[0].match_type == "lemma"
    assert results[0].matches[0].matched_form == "chevaux"


def test_exact_matches_are_returned_before_lemma_matches_across_cards():
    results = find_word_matches(
        ["chevaux"],
        [_card(1, "cheval"), _card(2, "chevaux")],
    )

    assert [match.card.id for match in results[0].matches] == [2, 1]
    assert [match.match_type for match in results[0].matches] == ["exact", "lemma"]


def test_unmatched_query_returns_an_empty_match_list():
    results = find_word_matches(["chat"], [_card(1, "le cheval")])

    assert results[0].matches == []
