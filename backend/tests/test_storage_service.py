from unittest.mock import Mock

import pytest

from app.services.storage_service import (
    StorageObjectNotFoundError,
    StorageObjectTooLargeError,
    StorageService,
)


def _build_storage_service() -> tuple[StorageService, Mock]:
    client = Mock()
    client.generate_presigned_url.return_value = "https://example.com/download"

    service = StorageService.__new__(StorageService)
    service._bucket_name = "test-bucket"
    service._client = client

    return service, client


class _NoSuchKeyError(Exception):
    """Minimal stand-in for the botocore NoSuchKey exception shape."""


class _Client404Error(Exception):
    """Minimal stand-in for a botocore ClientError with a NoSuchKey payload."""

    def __init__(self):
        super().__init__("not found")
        self.response = {
            "Error": {"Code": "NoSuchKey"},
            "ResponseMetadata": {"HTTPStatusCode": 404},
        }


class _Client404BucketError(Exception):
    """Minimal stand-in for a 404 bucket-level fault (NOT an absent object)."""

    def __init__(self):
        super().__init__("not found")
        self.response = {
            "Error": {"Code": "NoSuchBucket"},
            "ResponseMetadata": {"HTTPStatusCode": 404},
        }


def test_bounded_download_missing_key_raises_not_found() -> None:
    service, client = _build_storage_service()
    client.exceptions.NoSuchKey = _NoSuchKeyError
    client.get_object.side_effect = _NoSuchKeyError("missing")

    with pytest.raises(StorageObjectNotFoundError):
        service.download_file_bounded("uploads/7.pdf", max_bytes=10, folder=None)


def test_bounded_download_404_client_error_raises_not_found() -> None:
    service, client = _build_storage_service()
    # R2 may surface a missing key as a generic ClientError rather than NoSuchKey.
    client.exceptions.NoSuchKey = _NoSuchKeyError
    client.exceptions.ClientError = _Client404Error
    client.get_object.side_effect = _Client404Error()

    with pytest.raises(StorageObjectNotFoundError):
        service.download_file_bounded("uploads/7.pdf", max_bytes=10, folder=None)


def test_bounded_download_404_bucket_fault_propagates() -> None:
    # A 404 bucket-level fault must NOT be treated as an empty upload: it
    # surfaces as ClientError with Code != NoSuchKey and must propagate.
    service, client = _build_storage_service()
    client.exceptions.NoSuchKey = _NoSuchKeyError
    client.exceptions.ClientError = _Client404BucketError
    client.get_object.side_effect = _Client404BucketError()

    with pytest.raises(_Client404BucketError):
        service.download_file_bounded("uploads/7.pdf", max_bytes=10, folder=None)


def test_bounded_download_non_404_error_propagates() -> None:
    service, client = _build_storage_service()

    class _Client500Error(_Client404Error):
        def __init__(self):
            self.response = {"ResponseMetadata": {"HTTPStatusCode": 500}}

    client.exceptions.NoSuchKey = _NoSuchKeyError
    client.exceptions.ClientError = _Client500Error
    client.get_object.side_effect = _Client500Error()

    with pytest.raises(_Client500Error):
        service.download_file_bounded("uploads/7.pdf", max_bytes=10, folder=None)


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
