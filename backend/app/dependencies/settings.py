"""Settings-related dependency helpers."""

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.models import User, UserSettings


async def get_or_create_user_settings(
    session: AsyncSession,
    user: User,
) -> UserSettings:
    """Get current user's settings or create default settings row.

    Notes:
    - UserSettings.user_id is unique.
    - Two concurrent first-time requests can race to create the row.
      We handle this by retrying the read on unique-constraint violation.
    """
    result = await session.execute(
        select(UserSettings).where(UserSettings.user_id == user.id)
    )
    settings = result.scalar_one_or_none()

    if settings:
        return settings

    settings = UserSettings(user_id=user.id)
    session.add(settings)

    try:
        await session.flush()
        await session.refresh(settings)
        return settings
    except IntegrityError:
        # Another request likely created the row first.
        # Roll back the failed INSERT and re-read.
        await session.rollback()
        result = await session.execute(
            select(UserSettings).where(UserSettings.user_id == user.id)
        )
        settings = result.scalar_one_or_none()
        if settings:
            return settings
        raise
