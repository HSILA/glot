import hashlib
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, Mock

import fitz
import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy.exc import IntegrityError

from app.api.v1.resources import confirm_upload, request_upload, trigger_extraction
from app.models import Resource, User, UserResource
from app.schemas.resource import UploadRequest
from app.services.storage_service import (
    StorageObjectNotFoundError,
    StorageObjectTooLargeError,
)


def make_pdf() -> bytes:
    document = fitz.open()
    document.new_page()
    payload = document.tobytes()
    document.close()
    return payload


def make_upload_request(**overrides) -> UploadRequest:
    values = {
        "name": "Document",
        "file_name": "document.pdf",
        "content_type": "application/pdf",
        "size_bytes": 100,
        "content_hash": "a" * 64,
        "is_public": False,
    }
    values.update(overrides)
    return UploadRequest(**values)


def test_upload_request_requires_content_type():
    values = make_upload_request().model_dump()
    del values["content_type"]

    with pytest.raises(ValidationError, match="content_type"):
        UploadRequest(**values)


@pytest.mark.parametrize("content_hash", ["z" * 64, "A" * 64, "a" * 63])
def test_upload_request_rejects_invalid_sha256(content_hash):
    with pytest.raises(ValidationError, match="content_hash"):
        make_upload_request(content_hash=content_hash)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("content_type", "file_name"),
    [("text/plain", "document.pdf"), ("application/pdf", "document.txt")],
)
async def test_request_upload_rejects_disallowed_type_or_extension(
    content_type, file_name
):
    request = make_upload_request(content_type=content_type, file_name=file_name)

    with pytest.raises(HTTPException, match="PDF") as exc:
        await request_upload(
            request=request,
            session=AsyncMock(),
            current_user=User(id=1, email="user@example.com", password_hash="hash"),
            storage=Mock(),
        )

    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_request_upload_presigns_the_validated_content_type():
    request = make_upload_request()
    count_result = Mock()
    count_result.scalar.return_value = 0
    existing_result = Mock()
    existing_result.scalar_one_or_none.return_value = None
    session = AsyncMock()
    session.execute.side_effect = [existing_result, count_result]
    session.flush = AsyncMock()
    nested = AsyncMock()
    nested.__aenter__.return_value = None
    nested.__aexit__.return_value = False
    session.begin_nested = Mock(return_value=nested)
    session.add = Mock(
        side_effect=lambda item: setattr(item, "id", 1)
        if isinstance(item, Resource) and item.id is None
        else None
    )
    storage = Mock()
    storage.generate_upload_url.return_value = "https://upload.example"

    await request_upload(
        request=request,
        session=session,
        current_user=User(id=1, email="user@example.com", password_hash="hash"),
        storage=storage,
    )

    storage.generate_upload_url.assert_called_once_with(
        "uploads/1.pdf",
        folder=None,
        content_type="application/pdf",
        expires_in=900,
    )
    created_resource = next(
        call.args[0]
        for call in session.add.call_args_list
        if isinstance(call.args[0], Resource)
    )
    assert created_resource.upload_confirmed is False


@pytest.mark.asyncio
async def test_owner_can_resume_an_unconfirmed_upload():
    request = make_upload_request()
    pending = Resource(
        id=1,
        content_hash=request.content_hash,
        size_bytes=request.size_bytes,
        page_count=None,
        upload_confirmed=False,
        file_name=request.file_name,
        uploaded_by=1,
        uploaded_at=datetime.now(UTC) - timedelta(minutes=5),
    )
    previous_expiry_base = pending.uploaded_at
    link = UserResource(user_id=1, resource_id=1, name=request.name)
    existing_result = Mock()
    existing_result.scalar_one_or_none.return_value = pending
    link_result = Mock()
    link_result.scalar_one_or_none.return_value = link
    session = AsyncMock()
    session.execute.side_effect = [existing_result, link_result]
    session.add = Mock()
    storage = Mock()
    storage.generate_upload_url.return_value = "https://upload.example"

    response = await request_upload(
        request=request,
        session=session,
        current_user=User(id=1, email="user@example.com", password_hash="hash"),
        storage=storage,
    )

    assert response.resource_id == 1
    assert response.upload_url == "https://upload.example"
    assert pending.uploaded_at > previous_expiry_base
    storage.generate_upload_url.assert_called_once_with(
        "uploads/1.pdf",
        folder=None,
        content_type=request.content_type,
        expires_in=900,
    )
    assert session.execute.await_count == 2
    session.flush.assert_awaited_once()


@pytest.mark.asyncio
async def test_other_user_cannot_link_an_unconfirmed_upload():
    request = make_upload_request()
    pending = Resource(
        id=1,
        content_hash=request.content_hash,
        size_bytes=request.size_bytes,
        page_count=None,
        upload_confirmed=False,
        file_name=request.file_name,
        uploaded_by=1,
    )
    existing_result = Mock()
    existing_result.scalar_one_or_none.return_value = pending
    link_result = Mock()
    link_result.scalar_one_or_none.return_value = None
    session = AsyncMock()
    session.execute.side_effect = [existing_result, link_result]
    session.add = Mock()
    storage = Mock()

    with pytest.raises(HTTPException, match="still being validated") as exc:
        await request_upload(
            request=request,
            session=session,
            current_user=User(id=2, email="other@example.com", password_hash="hash"),
            storage=storage,
        )

    assert exc.value.status_code == 409
    session.add.assert_not_called()
    storage.generate_upload_url.assert_not_called()


@pytest.mark.asyncio
async def test_other_user_can_take_over_expired_upload_reservation():
    request = make_upload_request()
    pending = Resource(
        id=1,
        content_hash=request.content_hash,
        size_bytes=request.size_bytes,
        page_count=None,
        upload_confirmed=False,
        file_name=request.file_name,
        is_public=True,
        uploaded_by=1,
        uploaded_at=datetime.now(UTC) - timedelta(seconds=901),
    )
    no_link = Mock()
    no_link.scalar_one_or_none.return_value = None
    existing_result = Mock()
    existing_result.scalar_one_or_none.return_value = pending
    count_result = Mock()
    count_result.scalar.return_value = 0
    delete_result = Mock()
    session = AsyncMock()
    session.execute.side_effect = [
        existing_result,
        no_link,
        count_result,
        delete_result,
    ]
    session.add = Mock()
    session.flush = AsyncMock()
    storage = Mock()
    storage.async_delete_file = AsyncMock()
    storage.generate_upload_url.return_value = "https://upload.example"

    response = await request_upload(
        request=request,
        session=session,
        current_user=User(id=2, email="other@example.com", password_hash="hash"),
        storage=storage,
    )

    assert response.resource_id == 1
    assert response.upload_url == "https://upload.example"
    assert pending.uploaded_by == 2
    assert pending.is_public is request.is_public
    assert pending.upload_confirmed is False
    storage.async_delete_file.assert_awaited_once_with(
        "uploads/1.pdf",
        folder=None,
    )
    added_link = session.add.call_args.args[0]
    assert isinstance(added_link, UserResource)
    assert added_link.user_id == 2


@pytest.mark.asyncio
async def test_same_hash_insert_race_recovers_winning_resource():
    request = make_upload_request()
    winner = Resource(
        id=7,
        content_hash=request.content_hash,
        size_bytes=request.size_bytes,
        upload_confirmed=False,
        file_name=request.file_name,
        uploaded_by=1,
    )
    winner_link = UserResource(user_id=1, resource_id=7, name=request.name)
    no_existing = Mock()
    no_existing.scalar_one_or_none.return_value = None
    count_result = Mock()
    count_result.scalar.return_value = 0
    winner_result = Mock()
    winner_result.scalar_one_or_none.return_value = winner
    link_result = Mock()
    link_result.scalar_one_or_none.return_value = winner_link
    nested = AsyncMock()
    nested.__aenter__.return_value = None
    nested.__aexit__.return_value = False
    session = AsyncMock()
    session.execute.side_effect = [
        no_existing,
        count_result,
        winner_result,
        link_result,
    ]
    session.begin_nested = Mock(return_value=nested)
    session.add = Mock()
    session.flush = AsyncMock(
        side_effect=[
            IntegrityError("insert", {}, RuntimeError("duplicate")),
            None,
        ]
    )
    storage = Mock()
    storage.generate_upload_url.return_value = "https://upload.example"

    response = await request_upload(
        request=request,
        session=session,
        current_user=User(id=1, email="user@example.com", password_hash="hash"),
        storage=storage,
    )

    assert response.resource_id == 7
    assert response.upload_url == "https://upload.example"


@pytest.mark.asyncio
async def test_confirm_upload_rejects_invalid_pdf_and_cleans_up():
    invalid = b"not a pdf"
    resource = Resource(
        id=1,
        content_hash=hashlib.sha256(invalid).hexdigest(),
        size_bytes=len(invalid),
        upload_confirmed=False,
        file_name="document.pdf",
        uploaded_by=1,
    )
    user_resource = UserResource(user_id=1, resource_id=1, name="Document")
    user = User(id=1, email="user@example.com", password_hash="hash")
    result = Mock()
    result.scalar_one_or_none.return_value = user_resource
    session = AsyncMock()
    session.get.return_value = resource
    session.execute.return_value = result
    storage = Mock()
    storage.async_download_file_bounded = AsyncMock(return_value=invalid)
    storage.async_file_exists = AsyncMock(return_value=False)
    storage.async_delete_file = AsyncMock()

    with pytest.raises(HTTPException, match="valid PDF") as exc:
        await confirm_upload(
            resource_id=1,
            session=session,
            current_user=user,
            storage=storage,
        )

    assert exc.value.status_code == 400
    storage.async_delete_file.assert_awaited_once_with(
        "uploads/1.pdf",
        folder=None,
    )
    session.delete.assert_any_await(user_resource)
    session.delete.assert_any_await(resource)


@pytest.mark.asyncio
async def test_confirm_upload_rejects_oversized_object_before_reading():
    resource = Resource(
        id=1,
        content_hash="a" * 64,
        size_bytes=100,
        upload_confirmed=False,
        file_name="document.pdf",
        uploaded_by=1,
    )
    user_resource = UserResource(user_id=1, resource_id=1, name="Document")
    user = User(id=1, email="user@example.com", password_hash="hash")
    result = Mock()
    result.scalar_one_or_none.return_value = user_resource
    session = AsyncMock()
    session.get.return_value = resource
    session.execute.return_value = result
    storage = Mock()
    storage.async_download_file_bounded = AsyncMock(
        side_effect=StorageObjectTooLargeError("too large")
    )
    storage.async_delete_file = AsyncMock()

    with pytest.raises(HTTPException, match="size") as exc:
        await confirm_upload(
            resource_id=1,
            session=session,
            current_user=user,
            storage=storage,
        )

    assert exc.value.status_code == 400
    storage.async_download_file_bounded.assert_awaited_once_with(
        "uploads/1.pdf",
        folder=None,
        max_bytes=resource.size_bytes,
    )
    storage.async_delete_file.assert_awaited_once()


@pytest.mark.asyncio
async def test_confirm_upload_rejects_missing_staged_object():
    resource = Resource(
        id=1,
        content_hash="a" * 64,
        size_bytes=100,
        upload_confirmed=False,
        file_name="document.pdf",
        uploaded_by=1,
    )
    user_resource = UserResource(user_id=1, resource_id=1, name="Document")
    user = User(id=1, email="user@example.com", password_hash="hash")
    result = Mock()
    result.scalar_one_or_none.return_value = user_resource
    session = AsyncMock()
    session.get.return_value = resource
    session.execute.return_value = result
    storage = Mock()
    storage.async_download_file_bounded = AsyncMock(
        side_effect=StorageObjectNotFoundError("missing uploads/1.pdf")
    )
    storage.async_delete_file = AsyncMock()

    with pytest.raises(HTTPException, match="No file was uploaded") as exc:
        await confirm_upload(
            resource_id=1,
            session=session,
            current_user=user,
            storage=storage,
        )

    assert exc.value.status_code == 400
    storage.async_delete_file.assert_awaited_once()


@pytest.mark.asyncio
@pytest.mark.parametrize("mismatch", ["size", "hash"])
async def test_confirm_upload_rejects_content_identity_mismatch(mismatch):
    payload = make_pdf()
    expected_size = len(payload) + (1 if mismatch == "size" else 0)
    expected_hash = (
        "0" * 64 if mismatch == "hash" else hashlib.sha256(payload).hexdigest()
    )
    resource = Resource(
        id=1,
        content_hash=expected_hash,
        size_bytes=expected_size,
        upload_confirmed=False,
        file_name="document.pdf",
        uploaded_by=1,
    )
    user_resource = UserResource(user_id=1, resource_id=1, name="Document")
    user = User(id=1, email="user@example.com", password_hash="hash")
    result = Mock()
    result.scalar_one_or_none.return_value = user_resource
    session = AsyncMock()
    session.get.return_value = resource
    session.execute.return_value = result
    storage = Mock()
    storage.async_download_file_bounded = AsyncMock(return_value=payload)
    storage.async_file_exists = AsyncMock(return_value=False)
    storage.async_delete_file = AsyncMock()

    with pytest.raises(HTTPException, match="does not match"):
        await confirm_upload(
            resource_id=1,
            session=session,
            current_user=user,
            storage=storage,
        )

    storage.async_delete_file.assert_awaited_once()


@pytest.mark.asyncio
async def test_confirm_upload_accepts_matching_valid_pdf():
    payload = make_pdf()
    resource = Resource(
        id=1,
        content_hash=hashlib.sha256(payload).hexdigest(),
        size_bytes=len(payload),
        upload_confirmed=False,
        file_name="document.pdf",
        uploaded_by=1,
    )
    user_resource = UserResource(user_id=1, resource_id=1, name="Document")
    user = User(id=1, email="user@example.com", password_hash="hash")
    result = Mock()
    result.scalar_one_or_none.return_value = user_resource
    session = AsyncMock()
    session.get.return_value = resource
    session.execute.return_value = result
    session.refresh = AsyncMock()
    storage = Mock()
    storage.async_download_file_bounded = AsyncMock(return_value=payload)
    storage.async_file_exists = AsyncMock(return_value=True)
    storage.async_upload_file = AsyncMock()
    storage.async_delete_file = AsyncMock()

    response = await confirm_upload(
        resource_id=1,
        session=session,
        current_user=user,
        storage=storage,
    )

    assert resource.page_count == 1
    assert resource.upload_confirmed is True
    assert response.page_count == 1
    storage.async_upload_file.assert_awaited_once_with(
        payload,
        resource.content_hash,
        folder="raw",
        content_type="application/pdf",
    )
    storage.async_delete_file.assert_awaited_once_with(
        "uploads/1.pdf",
        folder=None,
    )
    session.delete.assert_not_awaited()
    session.get.assert_awaited_once_with(Resource, 1, with_for_update=True)


@pytest.mark.asyncio
async def test_confirmed_upload_cannot_be_promoted_again():
    resource = Resource(
        id=1,
        content_hash="a" * 64,
        size_bytes=100,
        upload_confirmed=True,
        file_name="document.pdf",
        uploaded_by=1,
    )
    session = AsyncMock()
    session.get.return_value = resource
    storage = Mock()

    with pytest.raises(HTTPException, match="already confirmed") as exc:
        await confirm_upload(
            resource_id=1,
            session=session,
            current_user=User(id=1, email="user@example.com", password_hash="hash"),
            storage=storage,
        )

    assert exc.value.status_code == 409
    storage.async_download_file_bounded.assert_not_called()


@pytest.mark.asyncio
async def test_unconfirmed_resource_cannot_start_extraction():
    resource = Resource(
        id=1,
        content_hash="a" * 64,
        size_bytes=100,
        page_count=None,
        upload_confirmed=False,
        file_name="document.pdf",
        uploaded_by=1,
    )
    link = UserResource(user_id=1, resource_id=1, name="Document")
    result = Mock()
    result.scalar_one_or_none.return_value = link
    session = AsyncMock()
    session.get.return_value = resource
    session.execute.return_value = result

    with pytest.raises(HTTPException, match="confirmed") as exc:
        await trigger_extraction(
            resource_id=1,
            session=session,
            current_user=User(id=1, email="user@example.com", password_hash="hash"),
        )

    assert exc.value.status_code == 409


@pytest.mark.asyncio
async def test_invalid_upload_db_cleanup_survives_storage_delete_failure():
    invalid = b"not a pdf"
    resource = Resource(
        id=1,
        content_hash=hashlib.sha256(invalid).hexdigest(),
        size_bytes=len(invalid),
        upload_confirmed=False,
        file_name="document.pdf",
        uploaded_by=1,
    )
    user_resource = UserResource(user_id=1, resource_id=1, name="Document")
    user = User(id=1, email="user@example.com", password_hash="hash")
    result = Mock()
    result.scalar_one_or_none.return_value = user_resource
    session = AsyncMock()
    session.get.return_value = resource
    session.execute.return_value = result
    storage = Mock()
    storage.async_download_file_bounded = AsyncMock(return_value=invalid)
    storage.async_delete_file = AsyncMock(side_effect=RuntimeError("R2 unavailable"))

    with pytest.raises(HTTPException, match="valid PDF"):
        await confirm_upload(
            resource_id=1,
            session=session,
            current_user=user,
            storage=storage,
        )

    session.delete.assert_any_await(user_resource)
    session.delete.assert_any_await(resource)
    session.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_thumbnail_storage_failure_does_not_reject_valid_pdf():
    payload = make_pdf()
    resource = Resource(
        id=1,
        content_hash=hashlib.sha256(payload).hexdigest(),
        size_bytes=len(payload),
        upload_confirmed=False,
        file_name="document.pdf",
        uploaded_by=1,
    )
    user_resource = UserResource(user_id=1, resource_id=1, name="Document")
    user = User(id=1, email="user@example.com", password_hash="hash")
    result = Mock()
    result.scalar_one_or_none.return_value = user_resource
    session = AsyncMock()
    session.get.return_value = resource
    session.execute.return_value = result
    storage = Mock()
    storage.async_download_file_bounded = AsyncMock(return_value=payload)
    storage.async_file_exists = AsyncMock(side_effect=RuntimeError("R2 unavailable"))
    storage.async_upload_file = AsyncMock()
    storage.async_delete_file = AsyncMock()

    response = await confirm_upload(
        resource_id=1,
        session=session,
        current_user=user,
        storage=storage,
    )

    assert response.page_count == 1
