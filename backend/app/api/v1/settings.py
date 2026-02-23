"""
Settings API endpoints.

Endpoints:
    GET  /settings - Get current user's settings
    PUT  /settings - Update current user's settings
"""

from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import (
    get_async_session,
    get_current_user,
    get_user_settings,
)
from app.models import User
from app.schemas import SettingsRead, SettingsUpdate

router = APIRouter()


@router.get("", response_model=SettingsRead)
async def get_settings(
    session: Annotated[AsyncSession, Depends(get_async_session)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    """
    Get the current user's scheduling settings.

    User-specific settings:
    - desired_retention: Target recall probability (0.7-0.97)
    - weights: Algorithm parameters (auto-initialized with defaults)

    Note: maximum_interval_days and enable_fuzz are global app settings,
    not returned here.
    """
    return await get_user_settings(session, current_user)


@router.put("", response_model=SettingsRead)
async def update_settings(
    settings_data: SettingsUpdate,
    session: Annotated[AsyncSession, Depends(get_async_session)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    """
    Update current user's scheduling settings.

    User-configurable:
    - desired_retention: How aggressive the scheduling should be

    Note: The 'weights' field can only be updated by the optimizer.
    """
    settings = await get_user_settings(session, current_user)

    update_data = settings_data.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(settings, key, value)

    settings.updated_at = datetime.now(UTC)
    await session.flush()
    await session.refresh(settings)

    return settings
