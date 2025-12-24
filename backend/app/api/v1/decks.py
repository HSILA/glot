"""
Decks API endpoints.

Endpoints:
    GET  /decks        - List all decks
    GET  /decks/{id}   - Get a single deck
    POST /decks        - Create a new deck
    PUT  /decks/{id}   - Update a deck
    DELETE /decks/{id} - Delete a deck
"""
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.db import get_async_session
from app.models import Deck
from app.schemas import DeckCreate, DeckRead, DeckUpdate

router = APIRouter()


@router.get("", response_model=list[DeckRead])
async def list_decks(
    session: Annotated[AsyncSession, Depends(get_async_session)],
    parent_id: int | None = Query(None, description="Filter by parent deck"),
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
):
    """
    List all decks with optional filters.

    Use parent_id=None to get root-level decks only.
    """
    query = select(Deck)

    if parent_id is not None:
        query = query.where(Deck.parent_id == parent_id)

    query = query.offset(offset).limit(limit)
    result = await session.execute(query)
    return result.scalars().all()


@router.get("/{deck_id}", response_model=DeckRead)
async def get_deck(
    deck_id: int,
    session: Annotated[AsyncSession, Depends(get_async_session)],
):
    """Get a single deck by ID."""
    deck = await session.get(Deck, deck_id)
    if not deck:
        raise HTTPException(status_code=404, detail="Deck not found")
    return deck


@router.post("", response_model=DeckRead, status_code=201)
async def create_deck(
    deck_data: DeckCreate,
    session: Annotated[AsyncSession, Depends(get_async_session)],
):
    """Create a new deck."""
    # Validate parent exists if specified
    if deck_data.parent_id:
        parent = await session.get(Deck, deck_data.parent_id)
        if not parent:
            raise HTTPException(status_code=400, detail="Parent deck not found")

    deck = Deck(**deck_data.model_dump())
    session.add(deck)
    await session.flush()
    await session.refresh(deck)
    return deck


@router.put("/{deck_id}", response_model=DeckRead)
async def update_deck(
    deck_id: int,
    deck_data: DeckUpdate,
    session: Annotated[AsyncSession, Depends(get_async_session)],
):
    """Update an existing deck."""
    deck = await session.get(Deck, deck_id)
    if not deck:
        raise HTTPException(status_code=404, detail="Deck not found")

    # Validate parent if changing
    if deck_data.parent_id is not None:
        if deck_data.parent_id == deck_id:
            raise HTTPException(status_code=400, detail="Deck cannot be its own parent")
        parent = await session.get(Deck, deck_data.parent_id)
        if not parent:
            raise HTTPException(status_code=400, detail="Parent deck not found")

    update_data = deck_data.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(deck, key, value)

    deck.updated_at = datetime.now(timezone.utc)
    await session.flush()
    await session.refresh(deck)
    return deck


@router.delete("/{deck_id}", status_code=204)
async def delete_deck(
    deck_id: int,
    session: Annotated[AsyncSession, Depends(get_async_session)],
):
    """
    Delete a deck.

    Note: Cards in this deck will have their deck_id set to null.
    """
    deck = await session.get(Deck, deck_id)
    if not deck:
        raise HTTPException(status_code=404, detail="Deck not found")

    await session.delete(deck)
