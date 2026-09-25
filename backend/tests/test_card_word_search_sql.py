"""SQLite integration tests for the portable lemma lookup."""

from sqlalchemy import create_engine, text

from app.models import Card
from app.services.card_word_search import build_word_search_statement


def test_model_has_nullable_front_lemma_and_plain_btree_index():
    lemma_column = Card.__table__.c.front_lemma

    assert lemma_column.nullable is True
    assert any(
        tuple(column.name for column in index.columns) == ("front_lemma", "deck_id")
        for index in Card.__table__.indexes
    )


def test_batch_lemma_query_filters_user_and_optional_deck_on_sqlite():
    engine = create_engine("sqlite://")
    with engine.begin() as connection:
        connection.execute(
            text(
                "CREATE TABLE decks (id INTEGER PRIMARY KEY, user_id INTEGER, name TEXT)"
            )
        )
        connection.execute(
            text(
                "CREATE TABLE cards ("
                "id INTEGER PRIMARY KEY, deck_id INTEGER, front_content TEXT, front_lemma TEXT)"
            )
        )
        connection.execute(
            text(
                "INSERT INTO decks VALUES "
                "(10, 7, 'French'), (11, 8, 'French'), (12, 7, 'Travel')"
            )
        )
        connection.execute(
            text(
                "INSERT INTO cards VALUES "
                "(100, 10, 'manger', 'manger'), "
                "(101, 11, 'manger', 'manger'), "
                "(102, 12, 'mangeaient', 'manger'), "
                "(103, 10, 'prendre soin', NULL), "
                "(104, 10, '**manger**', NULL)"
            )
        )

    statement = build_word_search_statement(["manger", "manger"], user_id=7)
    with engine.connect() as connection:
        rows = connection.execute(statement).mappings().all()

    assert {(row["card_id"], row["front_content"]) for row in rows} == {
        (100, "manger"),
        (102, "mangeaient"),
    }

    scoped = build_word_search_statement(["manger"], user_id=7, deck_id=10)
    with engine.connect() as connection:
        scoped_rows = connection.execute(scoped).mappings().all()

    assert [(row["card_id"], row["front_content"]) for row in scoped_rows] == [
        (100, "manger")
    ]
    engine.dispose()
