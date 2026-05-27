from unittest.mock import AsyncMock, Mock

import pytest

from app.api.v1.resources import get_download_url, get_thumbnail_url
from app.models import Resource, User, UserResource


class _ScalarResult:
    def __init__(self, value):
        self._value = value

    def scalar_one_or_none(self):
        return self._value


@pytest.mark.asyncio
async def test_get_download_url_returns_hash_filename_and_hash_based_url() -> None:
    content_hash = "a" * 64

    resource = Resource(
        id=1,
        content_hash=content_hash,
        size_bytes=123,
        page_count=1,
        file_name="original-name.pdf",
        is_public=False,
        uploaded_by=1,
    )
    current_user = User(
        id=1,
        email="user@example.com",
        password_hash="hashed",
        is_active=True,
    )
    user_resource = UserResource(
        user_id=1,
        resource_id=1,
        name="custom title",
    )

    session = AsyncMock()
    session.get.return_value = resource
    session.execute.return_value = _ScalarResult(user_resource)

    storage = Mock()
    storage.generate_download_url.return_value = "https://example.com/presigned"

    result = await get_download_url(
        resource_id=1,
        session=session,
        current_user=current_user,
        storage=storage,
    )

    assert result == {
        "url": "https://example.com/presigned",
        "filename": f"{content_hash}.pdf",
    }

    storage.generate_download_url.assert_called_once_with(
        content_hash,
        folder="raw",
        expires_in=3600,
    )


@pytest.mark.asyncio
async def test_get_thumbnail_url_uses_async_existence_check() -> None:
    content_hash = "b" * 64

    resource = Resource(
        id=1,
        content_hash=content_hash,
        size_bytes=123,
        page_count=1,
        file_name="original-name.pdf",
        is_public=False,
        uploaded_by=1,
    )
    current_user = User(
        id=1,
        email="user@example.com",
        password_hash="hashed",
        is_active=True,
    )
    user_resource = UserResource(
        user_id=1,
        resource_id=1,
        name="custom title",
    )

    session = AsyncMock()
    session.get.return_value = resource
    session.execute.return_value = _ScalarResult(user_resource)

    storage = Mock()
    storage.async_file_exists = AsyncMock(return_value=True)
    storage.generate_download_url.return_value = "https://example.com/thumb"

    result = await get_thumbnail_url(
        resource_id=1,
        session=session,
        current_user=current_user,
        storage=storage,
    )

    assert result == {"url": "https://example.com/thumb"}
    storage.async_file_exists.assert_awaited_once_with(
        content_hash,
        folder="thumbnails",
    )
    storage.generate_download_url.assert_called_once_with(
        content_hash,
        folder="thumbnails",
        expires_in=3600,
        response_content_type="image/webp",
    )
