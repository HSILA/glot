"""
Cards API endpoints.

Endpoints:
    GET  /cards          - List all cards (with filters)
    POST /cards/check-words - Check candidate words against existing cards
    GET  /cards/due      - Get cards due for review
    GET  /cards/due/summary - Study-eligible counts for one scope
    GET  /cards/due/batch - Next due batch plus scope counts
    GET  /cards/{id}     - Get a single card
    POST /cards          - Create a new card
    PUT  /cards/{id}     - Update a card
    DELETE /cards/{id}   - Delete a card
    POST /cards/{id}/review - Submit a review rating
    GET  /cards/{id}/preview - Preview next intervals without reviewing
"""

import asyncio
import hashlib
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from loguru import logger
from sqlalchemy import func, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.core.app_config import get_app_config
from app.core.french_word import prepare_search_word
from app.dependencies import (
    get_async_session,
    get_current_user,
    get_user_settings,
)
from app.models import Card, CardState, Deck, ReviewLog, ReviewSubmission, User
from app.schemas import (
    CardCreate,
    CardListResponse,
    CardRead,
    CardUpdate,
    CardWordSearchMatch,
    CardWordSearchRequest,
    CardWordSearchResponse,
    CardWordSearchResult,
    DueBatchResponse,
    DueSummary,
    NextStatesResponse,
)
from app.schemas.card import ReviewRequest, ReviewResponse
from app.services import FSRSService
from app.services.card_word_search import (
    CardWordSearchHit,
    build_word_search_results,
    build_word_search_statement,
)
from app.services.due_cards import (
    StudyScopeCounts,
    fetch_due_batch,
    fetch_study_counts,
)
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


async def _get_owned_card_for_update(
    session: AsyncSession,
    card_id: int,
    user_id: int,
) -> Card | None:
    """Get an owned card with its row locked for the duration of the review.

    The lock serializes concurrent reviews of the same card (two devices, or a
    retry racing its original request) so scheduling and review_version update
    from a consistent snapshot.
    """
    result = await session.execute(
        select(Card)
        .join(Deck, Card.deck_id == Deck.id)
        .where(Card.id == card_id, Deck.user_id == user_id)
        .with_for_update(of=Card)
    )
    return result.scalar_one_or_none()


def _review_fingerprint(
    card_id: int, rating: int, review_duration_ms: int | None
) -> str:
    """Stable hash of the fields that define one review submission.

    The client freezes all of these when it stages the operation, so a retry
    with the same request_id must present identical values; anything else is
    key reuse and is rejected.
    """
    duration = review_duration_ms if review_duration_ms is not None else ""
    return hashlib.sha256(f"{card_id}:{rating}:{duration}".encode()).hexdigest()


def _due_summary_read(
    counts: StudyScopeCounts, *, as_of: datetime, deck_id: int | None
) -> DueSummary:
    """Map service counts onto the API schema."""
    return DueSummary(
        scheduled_due_count=counts.scheduled_due_count,
        new_count=counts.new_count,
        total=counts.total,
        as_of=as_of,
        deck_id=deck_id,
    )


async def _validate_scope_deck(
    session: AsyncSession, scope_deck_id: int | None, user_id: int
) -> None:
    """Validate an optional summary scope deck (404 when missing/not owned)."""
    if scope_deck_id is None:
        return
    deck = await _get_owned_deck(session, scope_deck_id, user_id)
    if not deck:
        raise HTTPException(status_code=404, detail="Deck not found")


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
    policy = get_app_config().scheduling
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


async def _get_unique_owned_deck_id(
    session: AsyncSession,
    deck_name: str,
    user_id: int,
) -> int:
    """Resolve one owned deck name without choosing between duplicates."""
    result = await session.execute(
        select(Deck).where(Deck.user_id == user_id, Deck.name == deck_name)
    )
    decks = result.scalars().all()

    if not decks:
        raise HTTPException(status_code=404, detail="Deck not found")
    if len(decks) > 1:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Deck name is ambiguous",
        )

    deck_id = decks[0].id
    if deck_id is None:
        raise HTTPException(status_code=404, detail="Deck not found")
    return deck_id


@router.post("/check-words", response_model=CardWordSearchResponse)
async def check_card_words(
    request: CardWordSearchRequest,
    session: Annotated[AsyncSession, Depends(get_async_session)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    """Check candidate French words against existing card front content."""
    user_id = current_user.id
    if user_id is None:
        raise HTTPException(status_code=401, detail="Invalid user")

    deck_id = None
    if request.deck_name is not None:
        deck_id = await _get_unique_owned_deck_id(
            session,
            request.deck_name,
            user_id,
        )

    search_words = [prepare_search_word(word) for word in request.words]
    cards_query = build_word_search_statement(
        [word.lemma for word in search_words],
        user_id=user_id,
        deck_id=deck_id,
    )
    result = await session.execute(cards_query)
    hit_rows = result.mappings().all()
    word_results = await asyncio.to_thread(
        build_word_search_results,
        search_words,
        (CardWordSearchHit(**row) for row in hit_rows),
    )
    return CardWordSearchResponse(
        deck_name=request.deck_name,
        results=[
            CardWordSearchResult(
                query=word_result.query,
                normalized_query=word_result.normalized_query,
                lemma=word_result.lemma,
                has_match=word_result.match_count > 0,
                match_count=word_result.match_count,
                matches_truncated=word_result.matches_truncated,
                matches=[
                    CardWordSearchMatch(
                        card_id=match.card_id,
                        deck_id=match.deck_id,
                        deck_name=match.deck_name,
                        front_content=match.front_content,
                        matched_form=match.matched_form,
                        match_type=match.match_type,
                    )
                    for match in word_result.matches
                ],
            )
            for word_result in word_results
        ],
    )


@router.get("/due", response_model=list[CardRead])
async def get_due_cards(
    response: Response,
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

    The session page prefers `/due/batch`, which returns the same cards plus
    the scope counts; this endpoint is kept for compatibility.
    """
    if deck_id is not None:
        deck = await _get_owned_deck(session, deck_id, current_user.id)
        if not deck:
            raise HTTPException(status_code=404, detail="Deck not found")

    cards, _counts = await fetch_due_batch(
        session,
        user_id=current_user.id,
        as_of=datetime.now(UTC),
        limit=limit,
        deck_id=deck_id,
    )

    response.headers["Cache-Control"] = "no-store"
    return order_due_cards(cards, seed=seed)


@router.get("/due/summary", response_model=DueSummary)
async def get_due_summary(
    response: Response,
    session: Annotated[AsyncSession, Depends(get_async_session)],
    current_user: Annotated[User, Depends(get_current_user)],
    deck_id: int | None = None,
):
    """
    Study-eligible counts for one scope (all decks, or a single deck).

    This is the authoritative "how many cards are waiting" number: the study
    session header displays it, and the dashboard uses the same computation
    for its "cards to study" figure, so the two surfaces cannot disagree.
    """
    if deck_id is not None:
        deck = await _get_owned_deck(session, deck_id, current_user.id)
        if not deck:
            raise HTTPException(status_code=404, detail="Deck not found")

    as_of = datetime.now(UTC)
    counts = await fetch_study_counts(
        session, user_id=current_user.id, as_of=as_of, deck_id=deck_id
    )
    response.headers["Cache-Control"] = "no-store"
    return _due_summary_read(counts, as_of=as_of, deck_id=deck_id)


@router.get("/due/batch", response_model=DueBatchResponse)
async def get_due_batch(
    response: Response,
    session: Annotated[AsyncSession, Depends(get_async_session)],
    current_user: Annotated[User, Depends(get_current_user)],
    limit: int = Query(100, ge=1, le=100),
    deck_id: int | None = None,
    seed: int | None = Query(
        None,
        description="Optional RNG seed for a stable queue order across requests. "
        "Omit to randomise the order on every request.",
    ),
):
    """
    The next batch of due cards plus companion scope counts.

    Items and counts come from a single SQL snapshot, so the client can keep
    fetching batches until `items` is empty and trust that an empty batch with
    `summary.total == 0` is the only truthful "nothing left to review" signal.
    """
    if deck_id is not None:
        deck = await _get_owned_deck(session, deck_id, current_user.id)
        if not deck:
            raise HTTPException(status_code=404, detail="Deck not found")

    as_of = datetime.now(UTC)
    cards, counts = await fetch_due_batch(
        session,
        user_id=current_user.id,
        as_of=as_of,
        limit=limit,
        deck_id=deck_id,
    )

    response.headers["Cache-Control"] = "no-store"
    return DueBatchResponse(
        items=order_due_cards(cards, seed=seed),
        summary=_due_summary_read(counts, as_of=as_of, deck_id=deck_id),
        limit=limit,
    )


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

    # Lock the deck row: serializes sequence allocation and blocks racing deck
    # deletion, so a deck removed mid-request cannot receive new cards.
    locked_deck = await session.execute(
        select(Deck).where(Deck.id == deck.id).with_for_update()
    )
    if locked_deck.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail="Deck not found")

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
    await session.commit()
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
            locked_deck = await session.execute(
                select(Deck).where(Deck.id == target_deck.id).with_for_update()
            )
            if locked_deck.scalar_one_or_none() is None:
                raise HTTPException(status_code=404, detail="Deck not found")
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
    await session.commit()
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
    await session.commit()


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
    3. Bump review_version and return the updated card, the next possible
       intervals, and fresh scope counts for the session header

    Idempotency: when `request_id` is supplied, the first accepted submission
    for that key records the review and stores its response; a retry of the
    same key (lost response, flaky connection, resumed outbox) returns the
    stored response with `replayed=true` and never applies the rating twice.
    `expected_review_version` — the version the client saw when the card was
    loaded — rejects a stale submission with 409 instead of overwriting newer
    scheduling made elsewhere. `scope_deck_id`, when supplied, scopes the
    returned summary to one deck (the session's deck mode).
    """
    user_id = current_user.id

    if review.request_id is not None:
        fingerprint = _review_fingerprint(
            card_id, review.rating, review.review_duration_ms
        )
        # Claim the key first. ON CONFLICT DO NOTHING waits for a concurrent
        # in-flight insert of the same key to resolve, so a retry racing its
        # original request either wins the claim cleanly or, below, reads the
        # committed receipt.
        claim = await session.execute(
            pg_insert(ReviewSubmission)
            .values(
                user_id=user_id,
                request_id=review.request_id,
                fingerprint=fingerprint,
                card_id=card_id,
                # Placeholder: NOT NULL is enforced per statement, and the
                # completed snapshot is written in this same transaction, so
                # an incomplete receipt can never become visible.
                response_json={},
            )
            .on_conflict_do_nothing(constraint="ux_review_submissions_user_request")
            .returning(ReviewSubmission.id)
        )
        claimed_id = claim.scalar_one_or_none()

        if claimed_id is None:
            receipt = (
                await session.execute(
                    select(ReviewSubmission).where(
                        ReviewSubmission.user_id == user_id,
                        ReviewSubmission.request_id == review.request_id,
                    )
                )
            ).scalar_one_or_none()
            if receipt is None:
                # The conflicting transaction is still in flight or vanished;
                # nothing was recorded by this request, so ask for a retry.
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail={
                        "code": "duplicate_in_flight",
                        "message": (
                            "Duplicate submission is being processed; "
                            "retry shortly."
                        ),
                    },
                )
            if receipt.fingerprint != fingerprint:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="request_id was already used for a different review",
                )
            # Replay: answer from the stored snapshot (the rating is NOT
            # applied again) with fresh counts for the session header.
            stored = ReviewResponse.model_validate(receipt.response_json)
            await _validate_scope_deck(session, review.scope_deck_id, user_id)
            as_of = datetime.now(UTC)
            counts = await fetch_study_counts(
                session,
                user_id=user_id,
                as_of=as_of,
                deck_id=review.scope_deck_id,
            )
            return stored.model_copy(
                update={
                    "replayed": True,
                    "summary": _due_summary_read(
                        counts, as_of=as_of, deck_id=review.scope_deck_id
                    ),
                }
            )

        await _validate_scope_deck(session, review.scope_deck_id, user_id)

    card = await _get_owned_card_for_update(session, card_id, user_id)
    if not card:
        logger.warning(
            f"Review attempted on non-existent or unauthorized card {card_id}"
        )
        raise HTTPException(status_code=404, detail="Card not found")

    if (
        review.request_id is not None
        and review.expected_review_version is not None
        and card.review_version != review.expected_review_version
    ):
        # Another device recorded a review since this card was loaded; applying
        # this rating would overwrite newer scheduling. Return the fresh card
        # and counts so the client can reconcile its queue.
        as_of = datetime.now(UTC)
        counts = await fetch_study_counts(
            session, user_id=user_id, as_of=as_of, deck_id=review.scope_deck_id
        )
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "stale_review_version",
                "message": (
                    "Card was reviewed elsewhere since it was loaded; "
                    "refresh the card before rating it again."
                ),
                "card": CardRead.model_validate(card).model_dump(mode="json"),
                "summary": _due_summary_read(
                    counts, as_of=as_of, deck_id=review.scope_deck_id
                ).model_dump(mode="json"),
            },
        )

    # Capture state BEFORE review for logging
    stability_before = card.stability
    difficulty_before = card.difficulty
    state_before = card.state.value

    # Apply the review
    card, scheduled_days, elapsed_days = fsrs.apply_review(card, review.rating)
    card.review_version += 1

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

    summary: DueSummary | None = None
    if review.request_id is not None:
        as_of = datetime.now(UTC)
        counts = await fetch_study_counts(
            session, user_id=user_id, as_of=as_of, deck_id=review.scope_deck_id
        )
        summary = _due_summary_read(counts, as_of=as_of, deck_id=review.scope_deck_id)

    response_payload = ReviewResponse(
        card=CardRead.model_validate(card),
        next_states=next_states,
        message=f"Review recorded: rating={review.rating}",
        request_id=review.request_id,
        review_id=review_log.id,
        replayed=False,
        summary=summary,
    )

    if review.request_id is not None:
        # Complete the receipt in the same transaction as the review itself:
        # the stored snapshot only becomes visible together with the review.
        await session.execute(
            update(ReviewSubmission)
            .where(
                ReviewSubmission.user_id == user_id,
                ReviewSubmission.request_id == review.request_id,
            )
            .values(
                review_log_id=review_log.id,
                response_json=response_payload.model_dump(mode="json"),
            )
        )

    await session.commit()

    logger.info(
        f"Card {card_id} reviewed: rating={review.rating}, "
        f"next_review={card.next_review_at.isoformat() if card.next_review_at else 'N/A'}, "
        f"stability={card.stability:.2f}"
    )

    return response_payload
