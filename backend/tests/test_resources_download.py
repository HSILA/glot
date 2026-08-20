from unittest.mock import AsyncMock, Mock

import pytest
from fastapi import HTTPException

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
async def test_unconfirmed_public_upload_is_not_downloadable_by_other_users() -> None:
    resource = Resource(
        id=1,
        content_hash="c" * 64,
        size_bytes=123,
        page_count=None,
        upload_confirmed=False,
        file_name="pending.pdf",
        is_public=True,
        uploaded_by=1,
    )
    current_user = User(
        id=2,
        email="other@example.com",
        password_hash="hashed",
        is_active=True,
    )
    session = AsyncMock()
    session.get.return_value = resource
    session.execute.return_value = _ScalarResult(None)

    with pytest.raises(HTTPException) as exc:
        await get_download_url(
            resource_id=1,
            session=session,
            current_user=current_user,
            storage=Mock(),
        )

    assert exc.value.status_code == 403


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
