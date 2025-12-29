"""
Settings API endpoints.

TODO: These endpoints need to be refactored for multi-user support:
- Add authentication requirement
- Get/update the current user's settings instead of global settings
- Create default settings on user registration

Endpoints:
    GET  /settings - Get current user's settings
    PUT  /settings - Update current user's settings
"""
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.db import get_async_session
from app.models import UserSettings
from app.schemas import SettingsRead, SettingsUpdate

router = APIRouter()

# TODO: Replace with get_current_user dependency after auth is implemented
# For now, using first settings row as a placeholder


async def get_or_create_settings(session: AsyncSession) -> UserSettings:
    """
    Get existing settings or create default ones.
    
    TODO: After auth is implemented, this should:
    1. Get the current user from the request
    2. Query UserSettings by user_id
    3. Create default settings if none exist for that user
    """
    result = await session.execute(select(UserSettings).limit(1))
    settings = result.scalar_one_or_none()

    if not settings:
        # TODO: This will fail without a user_id after migration
        # For now, keeping for backwards compatibility during development
        settings = UserSettings(user_id=1)  # Placeholder - will need real user
        session.add(settings)
        await session.flush()
        await session.refresh(settings)

    return settings


@router.get("", response_model=SettingsRead)
async def get_settings(
    session: Annotated[AsyncSession, Depends(get_async_session)],
):
    """
    Get the current user's scheduling settings.

    User-specific settings:
    - desired_retention: Target recall probability (0.7-0.97)
    - weights: Algorithm parameters (auto-initialized with defaults)

    Note: maximum_interval_days and enable_fuzz are global app settings,
    not returned here.
    """
    return await get_or_create_settings(session)


@router.put("", response_model=SettingsRead)
async def update_settings(
    settings_data: SettingsUpdate,
    session: Annotated[AsyncSession, Depends(get_async_session)],
):
    """
    Update user's scheduling settings.

    User-configurable:
    - desired_retention: How aggressive the scheduling should be

    Note: The 'weights' field can only be updated by the optimizer.
    """
    settings = await get_or_create_settings(session)

    update_data = settings_data.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(settings, key, value)

    settings.updated_at = datetime.now(timezone.utc)
    await session.flush()
    await session.refresh(settings)

    return settings
