"""Settings-related dependency helpers."""

from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.models import User, UserSettings


async def get_user_settings(
    session: AsyncSession,
    user: User,
) -> UserSettings:
    """Get current user's settings.

    Assumes settings row always exists (created at signup).
    """
    result = await session.execute(
        select(UserSettings).where(UserSettings.user_id == user.id)
    )
    return result.scalar_one()
