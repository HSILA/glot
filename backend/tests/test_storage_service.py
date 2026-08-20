from unittest.mock import Mock

import pytest

from app.services.storage_service import StorageObjectTooLargeError, StorageService


def _build_storage_service() -> tuple[StorageService, Mock]:
    client = Mock()
    client.generate_presigned_url.return_value = "https://example.com/download"

    service = StorageService.__new__(StorageService)
    service._bucket_name = "test-bucket"
    service._client = client

    return service, client


def test_generate_download_url_uses_hash_filename_for_raw_downloads() -> None:
    service, client = _build_storage_service()

    url = service.generate_download_url("abc123")

    assert url == "https://example.com/download"
    client.generate_presigned_url.assert_called_once_with(
        "get_object",
        Params={
            "Bucket": "test-bucket",
            "Key": "raw/abc123.pdf",
            "ResponseContentDisposition": 'attachment; filename="abc123.pdf"',
        },
        ExpiresIn=3600,
    )


def test_generate_upload_url_can_target_staging_key() -> None:
    service, client = _build_storage_service()

    url = service.generate_upload_url(
        "uploads/7.pdf",
        folder=None,
        content_type="application/pdf",
    )

    assert url == "https://example.com/download"
    client.generate_presigned_url.assert_called_once_with(
        "put_object",
        Params={
            "Bucket": "test-bucket",
            "Key": "uploads/7.pdf",
            "ContentType": "application/pdf",
        },
        ExpiresIn=900,
    )


def test_generate_download_url_thumbnail_has_no_content_disposition() -> None:
    service, client = _build_storage_service()

    url = service.generate_download_url(
        "abc123",
        folder="thumbnails",
        response_content_type="image/webp",
    )

    assert url == "https://example.com/download"
    client.generate_presigned_url.assert_called_once_with(
        "get_object",
        Params={
            "Bucket": "test-bucket",
            "Key": "thumbnails/abc123.webp",
            "ResponseContentType": "image/webp",
        },
        ExpiresIn=3600,
    )


def test_bounded_download_rejects_content_length_before_reading() -> None:
    service, client = _build_storage_service()
    body = Mock()
    client.get_object.return_value = {"ContentLength": 11, "Body": body}

    with pytest.raises(StorageObjectTooLargeError):
        service.download_file_bounded("abc123", max_bytes=10)

    body.read.assert_not_called()
    body.close.assert_called_once()


def test_bounded_download_reads_at_most_limit_plus_one() -> None:
    service, client = _build_storage_service()
    body = Mock()
    body.read.return_value = b"0123456789"
    client.get_object.return_value = {"ContentLength": 10, "Body": body}

    payload = service.download_file_bounded("abc123", max_bytes=10)

    assert payload == b"0123456789"
    body.read.assert_called_once_with(11)
    body.close.assert_called_once()


def test_bounded_download_rejects_oversized_stream_without_content_length() -> None:
    service, client = _build_storage_service()
    body = Mock()
    body.read.return_value = b"01234567890"
    client.get_object.return_value = {"Body": body}

    with pytest.raises(StorageObjectTooLargeError):
        service.download_file_bounded("abc123", max_bytes=10)

    body.read.assert_called_once_with(11)
    body.close.assert_called_once()
