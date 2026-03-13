from unittest.mock import Mock

import pytest

from app.services.storage_service import StorageService


def _build_storage_service() -> tuple[StorageService, Mock]:
    client = Mock()
    client.generate_presigned_url.return_value = "https://example.com/download"

    service = StorageService.__new__(StorageService)
    service._bucket_name = "test-bucket"
    service._client = client

    return service, client


@pytest.mark.parametrize(
    ("filename", "expected"),
    [
        ("lesson-notes.pdf", 'attachment; filename="lesson-notes.pdf"'),
        ("evil\r\nX-Test: injected.pdf", 'attachment; filename="evil_X-Test_ injected.pdf"'),
        ("null\x00byte\x1fname.pdf", 'attachment; filename="null_byte_name.pdf"'),
        ('quote"file".pdf', 'attachment; filename="quote_file_.pdf"'),
        ("semi;colon.pdf", 'attachment; filename="semi_colon.pdf"'),
        ("résumé.pdf", 'attachment; filename="resume.pdf"'),
    ],
)
def test_generate_download_url_sanitizes_content_disposition_filename(
    filename: str,
    expected: str,
) -> None:
    service, client = _build_storage_service()

    url = service.generate_download_url("abc123", filename=filename)

    assert url == "https://example.com/download"
    client.generate_presigned_url.assert_called_once_with(
        "get_object",
        Params={
            "Bucket": "test-bucket",
            "Key": "raw/abc123.pdf",
            "ResponseContentDisposition": expected,
        },
        ExpiresIn=3600,
    )
