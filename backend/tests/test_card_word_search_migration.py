"""Migration test for the one-word lemma column and existing-card backfill."""

import importlib.util
from pathlib import Path

from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import create_engine, text

MIGRATION_PATH = (
    Path(__file__).parents[1] / "alembic" / "versions" / "0006_card_front_lemma.py"
)


def test_migration_does_not_import_live_word_rules():
    source = MIGRATION_PATH.read_text()

    assert "app.core.french_word" not in source


def test_migration_backfills_only_plain_single_word_fronts():
    assert MIGRATION_PATH.exists(), "front-lemma migration must exist"
    spec = importlib.util.spec_from_file_location(
        "card_front_lemma_migration", MIGRATION_PATH
    )
    assert spec is not None and spec.loader is not None
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)

    engine = create_engine("sqlite://")
    with engine.begin() as connection:
        connection.execute(
            text(
                "CREATE TABLE cards (id INTEGER PRIMARY KEY, deck_id INTEGER NOT NULL DEFAULT 1, front_content VARCHAR(10000) NOT NULL)"
            )
        )
        connection.execute(
            text(
                "INSERT INTO cards (id, front_content) VALUES "
                "(1, 'manger'), (2, 'MANGEAIENT'), (3, 'prendre soin'), "
                "(4, '**cheval**'), (5, 'cheval.'), "
                "(6, 'l''amour'), (7, 'porte-monnaie')"
            )
        )
        context = MigrationContext.configure(connection)
        with Operations.context(context):
            migration.upgrade()

        rows = connection.execute(
            text("SELECT id, front_lemma FROM cards ORDER BY id")
        ).all()

    assert rows == [
        (1, "manger"),
        (2, "manger"),
        (3, None),
        (4, None),
        (5, None),
        (6, None),
        (7, None),
    ]
    engine.dispose()
