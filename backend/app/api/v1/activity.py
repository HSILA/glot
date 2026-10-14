"""API endpoint for the study activity calendar (issue #126)."""

from typing import Annotated

from fastapi import APIRouter, Depends, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_async_session, get_current_user, get_user_settings
from app.models import User
from app.schemas import ActivityResponse
from app.services.activity import build_activity_snapshot

router = APIRouter()


@router.get("", response_model=ActivityResponse)
async def get_activity(
    response: Response,
    session: Annotated[AsyncSession, Depends(get_async_session)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> ActivityResponse:
    """Return the authenticated user's rolling 365-day study activity."""
    settings = await get_user_settings(session, current_user)
    snapshot = await build_activity_snapshot(
        session,
        user_id=current_user.id,
        settings=settings,
    )
    response.headers["Cache-Control"] = "no-store"
    return ActivityResponse(
        as_of=snapshot.as_of,
        timezone=snapshot.timezone,
        timezone_is_set=snapshot.timezone_is_set,
        today=snapshot.today,
        range_start=snapshot.range_start,
        range_end=snapshot.range_end,
        next_day_starts_at=snapshot.next_day_starts_at,
        today_review_count=snapshot.today_review_count,
        current_streak=snapshot.current_streak,
        longest_streak=snapshot.longest_streak,
        last_active_date=snapshot.last_active_date,
        days=[
            {"date": day.date, "review_count": day.review_count}
            for day in snapshot.days
        ],
    )
