"""
Settings-related dependency helpers.
"""

from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.models import User, UserSettings


async def get_or_create_user_settings(
    session: AsyncSession,
    user: User,
) -> UserSettings:
    """Get current user's settings or create default settings row."""
    result = await session.execute(
        select(UserSettings).where(UserSettings.user_id == user.id)
    )
    settings = result.scalar_one_or_none()

    if not settings:
        settings = UserSettings(user_id=user.id)
        session.add(settings)
        await session.flush()
        await session.refresh(settings)

    return settings
