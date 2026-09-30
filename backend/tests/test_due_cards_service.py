"""Statement-shape tests for the shared due-card service.

Compiled with a PostgreSQL dialect, these assert the clauses that matter for
correctness: user scoping is always present, the deck filter only appears when
scoped, the batch carries window counts over the same filtered set, and the
selection order is deterministic. Behavioural verification against a real
database lives in ``tests/integration/``.
"""

from datetime import UTC, datetime

from sqlalchemy.dialects import postgresql

from app.services.due_cards import (
    StudyScopeCounts,
    build_due_batch_statement,
    build_study_summary_statement,
)

AS_OF = datetime(2026, 9, 29, 12, 0, tzinfo=UTC)


def _sql(statement) -> str:
    return str(
        statement.compile(
            dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True}
        )
    )


def test_summary_is_user_scoped_and_global_by_default() -> None:
    sql = _sql(build_study_summary_statement(user_id=1, as_of=AS_OF))
    assert "decks.user_id = 1" in sql
    assert "cards.next_review_at <=" in sql
    assert "cards.state != " in sql
    # No per-deck filter: the only cards.deck_id mention is the join.
    assert "cards.deck_id = " not in sql.replace("cards.deck_id = decks.id", "")
    assert "cards.deck_id = 5" not in sql


def test_summary_applies_deck_scope_when_given() -> None:
    sql = _sql(build_study_summary_statement(user_id=1, as_of=AS_OF, deck_id=5))
    assert "cards.deck_id = 5" in sql


def test_batch_counts_share_the_selected_set() -> None:
    sql = _sql(build_due_batch_statement(user_id=1, as_of=AS_OF, limit=100))
    assert "OVER ()" in sql
    assert "AS scheduled_due_count" in sql
    assert "AS new_count" in sql
    assert "LIMIT 100" in sql
    assert "decks.user_id = 1" in sql


def test_batch_ordering_is_deterministic() -> None:
    sql = _sql(build_due_batch_statement(user_id=1, as_of=AS_OF, limit=10))
    assert "ORDER BY" in sql
    assert "NULLS FIRST" in sql
    assert "cards.id ASC" in sql


def test_batch_applies_deck_scope_when_given() -> None:
    sql = _sql(build_due_batch_statement(user_id=1, as_of=AS_OF, limit=10, deck_id=5))
    assert "cards.deck_id = 5" in sql


def test_counts_holder_keeps_total_consistent() -> None:
    counts = StudyScopeCounts(scheduled_due_count=2, new_count=1, total=3)
    assert counts.total == counts.scheduled_due_count + counts.new_count
