"""
Decks API endpoints.

Endpoints:
    GET  /decks        - List all decks
    GET  /decks/{id}   - Get a single deck
    POST /decks        - Create a new deck
    PUT  /decks/{id}   - Update a deck
    DELETE /decks/{id} - Delete a deck
"""

from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, case, and_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.dependencies import get_async_session, get_current_user
from app.models import Card, Deck, User, CardState
from app.schemas import DeckCreate, DeckRead, DeckUpdate

router = APIRouter()


@router.get("", response_model=list[DeckRead])
async def list_decks(
    session: Annotated[AsyncSession, Depends(get_async_session)],
    current_user: Annotated[User, Depends(get_current_user)],
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
):
    """List all decks owned by the current user (includes cards_count and stats)."""
    now = datetime.now(UTC)

    # Subquery to compute all card stats per deck in a single pass
    stats_subq = (
        select(
            Card.deck_id,
            func.count(Card.id).label("cards_count"),
            func.sum(case((Card.state == CardState.NEW, 1), else_=0)).label("new_count"),
            func.sum(
                case(
                    (
                        and_(
                            Card.state != CardState.NEW,
                            Card.next_review_at <= now,
                        ),
                        1,
                    ),
                    else_=0,
                )
            ).label("due_count"),
            func.max(Card.last_review_at).label("last_studied_at"),
        )
        .join(Deck, Deck.id == Card.deck_id)
        .where(Deck.user_id == current_user.id)
        .group_by(Card.deck_id)
        .subquery()
    )

    query = (
        select(
            Deck,
            func.coalesce(stats_subq.c.cards_count, 0).label("cards_count"),
            func.coalesce(stats_subq.c.new_count, 0).label("new_count"),
            func.coalesce(stats_subq.c.due_count, 0).label("due_count"),
            stats_subq.c.last_studied_at,
        )
        .outerjoin(stats_subq, stats_subq.c.deck_id == Deck.id)
        .where(Deck.user_id == current_user.id)
        .offset(offset)
        .limit(limit)
    )

    result = await session.execute(query)
    rows = result.all()

    return [
        DeckRead.model_validate({
            **deck.model_dump(),
            "cards_count": int(cards_count),
            "new_count": int(new_count),
            "due_count": int(due_count),
            "last_studied_at": last_studied_at,
        })
        for deck, cards_count, new_count, due_count, last_studied_at in rows
    ]


@router.get("/{deck_id}", response_model=DeckRead)
async def get_deck(
    deck_id: int,
    session: Annotated[AsyncSession, Depends(get_async_session)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    """Get a single deck by ID (owned by current user, includes cards_count and stats)."""
    now = datetime.now(UTC)

    # Subquery to compute all card stats for this deck
    stats_subq = (
        select(
            Card.deck_id,
            func.count(Card.id).label("cards_count"),
            func.sum(case((Card.state == CardState.NEW, 1), else_=0)).label("new_count"),
            func.sum(
                case(
                    (
                        and_(
                            Card.state != CardState.NEW,
                            Card.next_review_at <= now,
                        ),
                        1,
                    ),
                    else_=0,
                )
            ).label("due_count"),
            func.max(Card.last_review_at).label("last_studied_at"),
        )
        .where(Card.deck_id == deck_id)
        .group_by(Card.deck_id)
        .subquery()
    )

    result = await session.execute(
        select(
            Deck,
            func.coalesce(stats_subq.c.cards_count, 0).label("cards_count"),
            func.coalesce(stats_subq.c.new_count, 0).label("new_count"),
            func.coalesce(stats_subq.c.due_count, 0).label("due_count"),
            stats_subq.c.last_studied_at,
        )
        .outerjoin(stats_subq, stats_subq.c.deck_id == Deck.id)
        .where(Deck.id == deck_id, Deck.user_id == current_user.id)
    )

    row = result.first()
    if not row:
        raise HTTPException(status_code=404, detail="Deck not found")

    deck, cards_count, new_count, due_count, last_studied_at = row
    return DeckRead.model_validate({
        **deck.model_dump(),
        "cards_count": int(cards_count),
        "new_count": int(new_count),
        "due_count": int(due_count),
        "last_studied_at": last_studied_at,
    })


@router.post("", response_model=DeckRead, status_code=201)
async def create_deck(
    deck_data: DeckCreate,
    session: Annotated[AsyncSession, Depends(get_async_session)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    """Create a new deck owned by the current user."""
    deck = Deck(
        user_id=current_user.id,
        **deck_data.model_dump(),
    )
    session.add(deck)
    await session.flush()
    await session.refresh(deck)
    return deck


@router.put("/{deck_id}", response_model=DeckRead)
async def update_deck(
    deck_id: int,
    deck_data: DeckUpdate,
    session: Annotated[AsyncSession, Depends(get_async_session)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    """Update an existing deck (owned by current user)."""
    result = await session.execute(
        select(Deck).where(Deck.id == deck_id, Deck.user_id == current_user.id)
    )
    deck = result.scalar_one_or_none()
    if not deck:
        raise HTTPException(status_code=404, detail="Deck not found")

    update_data = deck_data.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(deck, key, value)

    deck.updated_at = datetime.now(UTC)
    await session.flush()
    await session.refresh(deck)
    return deck


@router.delete("/{deck_id}", status_code=204)
async def delete_deck(
    deck_id: int,
    session: Annotated[AsyncSession, Depends(get_async_session)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    """
    Delete a deck.

    Note: Cards in this deck will have their deck_id set to null.
    """
    result = await session.execute(
        select(Deck).where(Deck.id == deck_id, Deck.user_id == current_user.id)
    )
    deck = result.scalar_one_or_none()
    if not deck:
        raise HTTPException(status_code=404, detail="Deck not found")

    await session.delete(deck)
