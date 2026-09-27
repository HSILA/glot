"""Regression tests for deleting resources with extraction history (issue #22).

page_extractions.resource_id pointed at resources.id with no ON DELETE CASCADE,
so deleting a resource blocked on the FK and the API returned a phantom 204.
Extraction rows are derived data: they have no meaning once their resource is
gone, so the FK must cascade.
"""

from app.models import PageExtraction


def test_page_extraction_resource_fk_cascades_on_delete() -> None:
    """Deleting a resource must cascade to its page extractions (not block it)."""
    table = PageExtraction.__table__
    fk = next(
        fk for fk in table.foreign_key_constraints
        if [c.name for c in fk.columns] == ["resource_id"]
    )

    assert fk.referred_table.name == "resources"
    assert fk.ondelete == "CASCADE"


def test_page_extraction_resource_id_is_indexed() -> None:
    """The resource_id column keeps its index (used by progress lookups)."""
    resource_indexes = [
        [c.name for c in ix.columns]
        for ix in PageExtraction.__table__.indexes
    ]
    assert ["resource_id"] in resource_indexes
