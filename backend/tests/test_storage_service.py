from unittest.mock import Mock

from app.services.storage_service import StorageService


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
