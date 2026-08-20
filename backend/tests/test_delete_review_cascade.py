"""Regression tests for deleting cards with review history.

Deleting a reviewed card used to fail silently: ``review_logs.card_id`` pointed
at ``cards.id`` with no ``ON DELETE CASCADE``, so the DB DELETE raised an
IntegrityError after the API had already returned 204 (the session dependency
commits in post-response teardown). The card survived while the client was told
it was gone.

These tests assert the invariant that prevents the regression: the
``review_logs → cards`` FK must cascade on delete.
"""

from app.models import ReviewLog


def test_review_log_card_fk_cascades_on_delete() -> None:
    """Deleting a card must cascade to its review logs (not block it)."""
    table = ReviewLog.__table__
    fk = next(
        fk for fk in table.foreign_key_constraints
        if [c.name for c in fk.columns] == ["card_id"]
    )

    assert fk.referred_table.name == "cards"
    assert fk.ondelete == "CASCADE"


def test_review_log_card_id_is_indexed() -> None:
    """The card_id column keeps its index (used by review-history lookups)."""
    card_indexes = [
        [c.name for c in ix.columns]
        for ix in ReviewLog.__table__.indexes
    ]
    assert ["card_id"] in card_indexes, f"no index on card_id: {card_indexes}"
