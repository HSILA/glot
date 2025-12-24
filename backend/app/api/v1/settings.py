"""
Settings API endpoints.

Endpoints:
    GET  /settings - Get current global settings
    PUT  /settings - Update global settings
"""
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.db import get_async_session
from app.models import AppSettings
from app.schemas import SettingsRead, SettingsUpdate

router = APIRouter()


async def get_or_create_settings(session: AsyncSession) -> AppSettings:
    """Get existing settings or create default ones."""
    result = await session.execute(select(AppSettings).limit(1))
    settings = result.scalar_one_or_none()

    if not settings:
        settings = AppSettings()
        session.add(settings)
        await session.flush()
        await session.refresh(settings)

    return settings


@router.get("", response_model=SettingsRead)
async def get_settings(
    session: Annotated[AsyncSession, Depends(get_async_session)],
):
    """
    Get the current global FSRS settings.

    Settings include:
    - desired_retention: Target recall probability (0.7-0.97)
    - maximum_interval_days: Maximum days between reviews
    - enable_fuzz: Whether to add randomness to intervals
    - weights: FSRS algorithm parameters (null = defaults)
    """
    return await get_or_create_settings(session)


@router.put("", response_model=SettingsRead)
async def update_settings(
    settings_data: SettingsUpdate,
    session: Annotated[AsyncSession, Depends(get_async_session)],
):
    """
    Update the global FSRS settings.

    Only user-configurable settings can be updated:
    - desired_retention
    - maximum_interval_days
    - enable_fuzz

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
