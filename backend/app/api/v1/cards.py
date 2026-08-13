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

from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from loguru import logger
from sqlalchemy import case, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.core.scheduling import get_scheduling_policy
from app.dependencies import (
    get_async_session,
    get_current_user,
    get_user_settings,
)
from app.models import Card, CardState, Deck, ReviewLog, User
from app.schemas import (
    CardCreate,
    CardListResponse,
    CardRead,
    CardUpdate,
    NextStatesResponse,
)
from app.schemas.card import ReviewRequest, ReviewResponse
from app.services import FSRSService
from app.services.review_queue import order_due_cards

router = APIRouter()


async def _get_owned_deck(
    session: AsyncSession,
    deck_id: int,
    user_id: int,
) -> Deck | None:
    """Get a deck only if it belongs to the current user."""
    result = await session.execute(
        select(Deck).where(Deck.id == deck_id, Deck.user_id == user_id)
    )
    return result.scalar_one_or_none()


async def _get_owned_card(
    session: AsyncSession,
    card_id: int,
    user_id: int,
) -> Card | None:
    """Get a card only if it belongs to a deck owned by the current user."""
    result = await session.execute(
        select(Card)
        .join(Deck, Card.deck_id == Deck.id)
        .where(Card.id == card_id, Deck.user_id == user_id)
    )
    return result.scalar_one_or_none()


async def get_fsrs_service_from_db(
    session: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(get_current_user),
) -> FSRSService:
    """Get scheduling service configured from current user + global settings.

    Note:
    - Some card endpoints also depend on get_current_user directly.
    - FastAPI caches dependencies per-request, so user resolution is shared
      within the same request context.
    """
    policy = get_scheduling_policy()
    settings = await get_user_settings(session, current_user)

    return FSRSService(
        desired_retention=settings.desired_retention,
        maximum_interval_days=policy.maximum_interval_days,  # Global policy
        enable_fuzz=policy.enable_fuzz,  # Global policy
        weights=settings.weights,
    )


@router.get("", response_model=CardListResponse)
async def list_cards(
    session: Annotated[AsyncSession, Depends(get_async_session)],
    current_user: Annotated[User, Depends(get_current_user)],
    state: CardState | None = None,
    deck_id: int | None = None,
    tag: str | None = Query(None, description="Filter by tag"),
    limit: int = Query(10, ge=1, le=1000),
    offset: int = Query(0, ge=0),
):
    """
    List all cards with optional filters.

    Filters:
    - state: Filter by FSRS state (new, learning, review, relearning)
    - deck_id: Filter by deck
    - tag: Filter by tag (cards containing this tag)
    """
    if deck_id is not None:
        deck = await _get_owned_deck(session, deck_id, current_user.id)
        if not deck:
            raise HTTPException(status_code=404, detail="Deck not found")

    base_filters = [Deck.user_id == current_user.id]

    if state:
        base_filters.append(Card.state == state)
    if deck_id:
        base_filters.append(Card.deck_id == deck_id)
    if tag:
        # JSONB array containment for tags
        base_filters.append(Card.tags.contains([tag]))

    # Total count (for pagination + correct "no more cards" UI)
    total_query = (
        select(func.count())
        .select_from(Card)
        .join(Deck, Card.deck_id == Deck.id)
        .where(*base_filters)
    )
    total = (await session.execute(total_query)).scalar_one()

    # Deterministic ordering: newest first
    items_query = (
        select(Card)
        .join(Deck, Card.deck_id == Deck.id)
        .where(*base_filters)
        .order_by(Card.created_at.desc(), Card.id.desc())
        .offset(offset)
        .limit(limit)
    )

    result = await session.execute(items_query)
    items = result.scalars().all()

    return CardListResponse(items=items, total=total, limit=limit, offset=offset)


@router.get("/due", response_model=list[CardRead])
async def get_due_cards(
    session: Annotated[AsyncSession, Depends(get_async_session)],
    current_user: Annotated[User, Depends(get_current_user)],
    limit: int = Query(20, ge=1, le=100),
    deck_id: int | None = None,
    seed: int | None = Query(
        None,
        description="Optional RNG seed for a stable queue order across requests. "
        "Omit to randomise the order on every request.",
    ),
):
    """
    Get cards due for review.

    Returns cards where next_review_at <= now, plus new cards.

    Selection (which cards fit within `limit`) is priority-based:
    learning/relearning first, then most-overdue reviews, then new cards.

    Presentation order is non-sequential: learning/relearning come first, then
    review and new cards are shuffled and interleaved so the queue does not
    follow a fixed deterministic order. Pass `seed` for a stable order.
    """
    if deck_id is not None:
        deck = await _get_owned_deck(session, deck_id, current_user.id)
        if not deck:
            raise HTTPException(status_code=404, detail="Deck not found")

    now = datetime.now(UTC)

    query = (
        select(Card)
        .join(Deck, Card.deck_id == Deck.id)
        .where(
            Deck.user_id == current_user.id,
            (Card.next_review_at <= now) | (Card.state == CardState.NEW),
        )
    )

    if deck_id:
        query = query.where(Card.deck_id == deck_id)

    # Priority for which cards make the `limit` cut: learning/relearning first,
    # then due reviews, then new. Within a tier, most-overdue first so we never
    # randomly drop overdue cards. Presentation order is randomised afterwards.
    priority = case(
        (Card.state.in_((CardState.LEARNING, CardState.RELEARNING)), 0),
        (Card.state == CardState.REVIEW, 1),
        else_=2,
    )
    query = query.order_by(
        priority.asc(), Card.next_review_at.asc().nullsfirst()
    ).limit(limit)

    result = await session.execute(query)
    due_cards = result.scalars().all()

    return order_due_cards(due_cards, seed=seed)


@router.get("/{card_id}", response_model=CardRead)
async def get_card(
    card_id: int,
    session: Annotated[AsyncSession, Depends(get_async_session)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    """Get a single card by ID if owned by current user."""
    card = await _get_owned_card(session, card_id, current_user.id)
    if not card:
        raise HTTPException(status_code=404, detail="Card not found")
    return card


@router.post("", response_model=CardRead, status_code=201)
async def create_card(
    card_data: CardCreate,
    session: Annotated[AsyncSession, Depends(get_async_session)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    """
    Create a new flashcard.

    The card starts in 'new' state with no scheduling.
    It will appear in /cards/due until first review.
    """
    deck = await _get_owned_deck(session, card_data.deck_id, current_user.id)
    if not deck:
        raise HTTPException(status_code=404, detail="Deck not found")

    # Lock deck row to avoid sequence races when multiple cards are created concurrently.
    await session.execute(select(Deck).where(Deck.id == deck.id).with_for_update())

    next_sequence_query = select(func.coalesce(func.max(Card.sequence), 0) + 1).where(
        Card.deck_id == deck.id
    )
    next_sequence = (await session.execute(next_sequence_query)).scalar_one()

    payload = card_data.model_dump()
    # Persist recognized language fields without None-noise and with enums
    # (gender/word_type) serialized to plain strings; legacy keys are preserved.
    payload["meta_data"] = card_data.meta_data.model_dump(
        mode="json", exclude_none=True
    )
    payload["sequence"] = int(next_sequence)

    card = Card(**payload)
    session.add(card)
    await session.flush()
    await session.refresh(card)
    logger.info(f"Created card {card.id} (seq={card.sequence})")
    return card


@router.put("/{card_id}", response_model=CardRead)
async def update_card(
    card_id: int,
    card_data: CardUpdate,
    session: Annotated[AsyncSession, Depends(get_async_session)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    """Update an existing card's content (not scheduling)."""
    card = await _get_owned_card(session, card_id, current_user.id)
    if not card:
        raise HTTPException(status_code=404, detail="Card not found")

    update_data = card_data.model_dump(exclude_unset=True)

    if "meta_data" in update_data:
        # Normalize metadata to clean JSONB: drop None-valued known fields and
        # serialize enums to plain strings. An explicit null clears it to {} so
        # we never violate the non-nullable column.
        update_data["meta_data"] = (
            card_data.meta_data.model_dump(mode="json", exclude_none=True)
            if card_data.meta_data is not None
            else {}
        )

    if "deck_id" in update_data:
        if update_data["deck_id"] is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="deck_id cannot be null",
            )

        target_deck = await _get_owned_deck(
            session, update_data["deck_id"], current_user.id
        )
        if not target_deck:
            raise HTTPException(status_code=404, detail="Deck not found")

        # If moving decks, assign a new sequence in the target deck.
        if int(update_data["deck_id"]) != int(card.deck_id):
            await session.execute(
                select(Deck)
                .where(Deck.id == target_deck.id)
                .with_for_update()
            )
            next_sequence_query = select(
                func.coalesce(func.max(Card.sequence), 0) + 1
            ).where(Card.deck_id == target_deck.id)
            update_data["sequence"] = int(
                (await session.execute(next_sequence_query)).scalar_one()
            )

    for key, value in update_data.items():
        setattr(card, key, value)

    card.updated_at = datetime.now(UTC)
    await session.flush()
    await session.refresh(card)
    return card


@router.delete("/{card_id}", status_code=204)
async def delete_card(
    card_id: int,
    session: Annotated[AsyncSession, Depends(get_async_session)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    """Delete a card if owned by current user."""
    card = await _get_owned_card(session, card_id, current_user.id)
    if not card:
        raise HTTPException(status_code=404, detail="Card not found")

    await session.delete(card)


@router.get("/{card_id}/preview", response_model=NextStatesResponse)
async def preview_review(
    card_id: int,
    session: Annotated[AsyncSession, Depends(get_async_session)],
    current_user: Annotated[User, Depends(get_current_user)],
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
    card = await _get_owned_card(session, card_id, current_user.id)
    if not card:
        raise HTTPException(status_code=404, detail="Card not found")

    return fsrs.get_next_states_response(card)


@router.post("/{card_id}/review", response_model=ReviewResponse)
async def review_card(
    card_id: int,
    review: ReviewRequest,
    session: Annotated[AsyncSession, Depends(get_async_session)],
    current_user: Annotated[User, Depends(get_current_user)],
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
    card = await _get_owned_card(session, card_id, current_user.id)
    if not card:
        logger.warning(f"Review attempted on non-existent or unauthorized card {card_id}")
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
