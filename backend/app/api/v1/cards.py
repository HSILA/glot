"""
Cards API endpoints.

Endpoints:
    GET  /cards          - List all cards (with filters)
    GET  /cards/due      - Get cards due for review
    GET  /cards/{id}     - Get a single card
    POST /cards          - Create a new card
    PUT  /cards/{id}     - Update a card
    DELETE /cards/{id}   - Delete a card
    POST /cards/{id}/review - Submit a review rating
    GET  /cards/{id}/preview - Preview next intervals without reviewing
"""
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.db import get_async_session
from app.models import AppSettings, Card, CardState, ReviewLog
from app.schemas import CardCreate, CardRead, CardUpdate, NextStatesResponse
from app.schemas.card import ReviewRequest, ReviewResponse
from app.services import FSRSService

router = APIRouter()


async def get_fsrs_service_from_db(
    session: AsyncSession = Depends(get_async_session),
) -> FSRSService:
    """Get FSRS service configured from database settings."""
    result = await session.execute(select(AppSettings).limit(1))
    settings = result.scalar_one_or_none()

    if settings:
        return FSRSService(
            desired_retention=settings.desired_retention,
            maximum_interval_days=settings.maximum_interval_days,
            enable_fuzz=settings.enable_fuzz,
            weights=settings.weights,
        )

    # Return default service if no settings exist
    return FSRSService()


@router.get("", response_model=list[CardRead])
async def list_cards(
    session: Annotated[AsyncSession, Depends(get_async_session)],
    state: CardState | None = None,
    deck_id: int | None = None,
    tag: str | None = Query(None, description="Filter by tag"),
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
):
    """
    List all cards with optional filters.

    Filters:
    - state: Filter by FSRS state (new, learning, review, relearning)
    - deck_id: Filter by deck
    - tag: Filter by tag (cards containing this tag)
    """
    query = select(Card)

    if state:
        query = query.where(Card.state == state)
    if deck_id:
        query = query.where(Card.deck_id == deck_id)
    if tag:
        # JSONB array containment for tags
        query = query.where(Card.tags.contains([tag]))

    query = query.offset(offset).limit(limit)
    result = await session.execute(query)
    return result.scalars().all()


@router.get("/due", response_model=list[CardRead])
async def get_due_cards(
    session: Annotated[AsyncSession, Depends(get_async_session)],
    limit: int = Query(20, ge=1, le=100),
    deck_id: int | None = None,
):
    """
    Get cards due for review.

    Returns cards where next_review_at <= now, plus new cards.
    Ordered by: overdue cards first (oldest), then new cards.
    """
    now = datetime.now(timezone.utc)

    query = select(Card).where(
        (Card.next_review_at <= now) | (Card.state == CardState.NEW)
    )

    if deck_id:
        query = query.where(Card.deck_id == deck_id)

    # Order: overdue first (most overdue at top), then new
    query = query.order_by(Card.next_review_at.asc().nullsfirst()).limit(limit)

    result = await session.execute(query)
    return result.scalars().all()


@router.get("/{card_id}", response_model=CardRead)
async def get_card(
    card_id: int,
    session: Annotated[AsyncSession, Depends(get_async_session)],
):
    """Get a single card by ID."""
    card = await session.get(Card, card_id)
    if not card:
        raise HTTPException(status_code=404, detail="Card not found")
    return card


@router.post("", response_model=CardRead, status_code=201)
async def create_card(
    card_data: CardCreate,
    session: Annotated[AsyncSession, Depends(get_async_session)],
):
    """
    Create a new flashcard.

    The card starts in 'new' state with no scheduling.
    It will appear in /cards/due until first review.
    """
    card = Card(**card_data.model_dump())
    session.add(card)
    await session.flush()
    await session.refresh(card)
    logger.info(f"Created card {card.id}: {card.front_content[:50]}")
    return card


@router.put("/{card_id}", response_model=CardRead)
async def update_card(
    card_id: int,
    card_data: CardUpdate,
    session: Annotated[AsyncSession, Depends(get_async_session)],
):
    """Update an existing card's content (not scheduling)."""
    card = await session.get(Card, card_id)
    if not card:
        raise HTTPException(status_code=404, detail="Card not found")

    update_data = card_data.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(card, key, value)

    card.updated_at = datetime.now(timezone.utc)
    await session.flush()
    await session.refresh(card)
    return card


@router.delete("/{card_id}", status_code=204)
async def delete_card(
    card_id: int,
    session: Annotated[AsyncSession, Depends(get_async_session)],
):
    """Delete a card."""
    card = await session.get(Card, card_id)
    if not card:
        raise HTTPException(status_code=404, detail="Card not found")

    await session.delete(card)


@router.get("/{card_id}/preview", response_model=NextStatesResponse)
async def preview_review(
    card_id: int,
    session: Annotated[AsyncSession, Depends(get_async_session)],
    fsrs: Annotated[FSRSService, Depends(get_fsrs_service_from_db)],
):
    """
    Preview next intervals for a card without recording a review.

    Returns the predicted intervals for each rating option:
    - Again (1): Reset stability
    - Hard (2): Small increase
    - Good (3): Standard increase
    - Easy (4): Large increase
    """
    card = await session.get(Card, card_id)
    if not card:
        raise HTTPException(status_code=404, detail="Card not found")

    return fsrs.get_next_states_response(card)


@router.post("/{card_id}/review", response_model=ReviewResponse)
async def review_card(
    card_id: int,
    review: ReviewRequest,
    session: Annotated[AsyncSession, Depends(get_async_session)],
    fsrs: Annotated[FSRSService, Depends(get_fsrs_service_from_db)],
):
    """
    Submit a review rating for a card.

    Ratings:
    - 1 = Again (failed to recall)
    - 2 = Hard (difficult recall)
    - 3 = Good (normal recall)
    - 4 = Easy (effortless recall)

    This will:
    1. Log the review to ReviewLog (for future optimizer training)
    2. Update the card's FSRS scheduling (difficulty, stability, next_review_at)
    3. Return the updated card and next possible intervals
    """
    card = await session.get(Card, card_id)
    if not card:
        logger.warning(f"Review attempted on non-existent card {card_id}")
        raise HTTPException(status_code=404, detail="Card not found")

    # Capture state BEFORE review for logging
    stability_before = card.stability
    difficulty_before = card.difficulty
    state_before = card.state.value

    # Apply the review
    card, scheduled_days, elapsed_days = fsrs.apply_review(card, review.rating)

    # Log the review for optimizer training
    review_log = ReviewLog(
        card_id=card_id,
        rating=review.rating,
        review_duration_ms=review.review_duration_ms,
        stability_before=stability_before,
        difficulty_before=difficulty_before,
        state_before=state_before,
        scheduled_days=scheduled_days,
        elapsed_days=elapsed_days,
    )
    session.add(review_log)

    await session.flush()
    await session.refresh(card)

    # Get next states for response
    next_states = fsrs.get_next_states_response(card)

    logger.info(
        f"Card {card_id} reviewed: rating={review.rating}, "
        f"next_review={card.next_review_at.isoformat() if card.next_review_at else 'N/A'}, "
        f"stability={card.stability:.2f}"
    )

    return ReviewResponse(
        card=CardRead.model_validate(card),
        next_states=next_states,
        message=f"Review recorded: rating={review.rating}",
    )
