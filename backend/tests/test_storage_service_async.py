import pytest

from app.services.storage_service import StorageService


@pytest.mark.asyncio
async def test_async_download_file_uses_to_thread(monkeypatch: pytest.MonkeyPatch) -> None:
    service = StorageService.__new__(StorageService)

    called = {}

    async def fake_to_thread(func, *args):
        called["func"] = func
        called["args"] = args
        return b"pdf-bytes"

    monkeypatch.setattr("app.services.storage_service.asyncio.to_thread", fake_to_thread)

    result = await service.async_download_file("abc123", folder="raw")

    assert result == b"pdf-bytes"
    assert called["func"] == service.download_file
    assert called["args"] == ("abc123", "raw")


@pytest.mark.asyncio
async def test_async_bounded_download_uses_to_thread(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service = StorageService.__new__(StorageService)
    called = {}

    async def fake_to_thread(func, *args):
        called["func"] = func
        called["args"] = args
        return b"pdf-bytes"

    monkeypatch.setattr("app.services.storage_service.asyncio.to_thread", fake_to_thread)

    result = await service.async_download_file_bounded(
        "abc123",
        folder="raw",
        max_bytes=123,
    )

    assert result == b"pdf-bytes"
    assert called["func"] == service.download_file_bounded
    assert called["args"] == ("abc123", 123, "raw")


@pytest.mark.asyncio
async def test_async_file_exists_uses_to_thread(monkeypatch: pytest.MonkeyPatch) -> None:
    service = StorageService.__new__(StorageService)

    called = {}

    async def fake_to_thread(func, *args):
        called["func"] = func
        called["args"] = args
        return True

    monkeypatch.setattr("app.services.storage_service.asyncio.to_thread", fake_to_thread)

    exists = await service.async_file_exists("abc123", folder="thumbnails")

    assert exists is True
    assert called["func"] == service.file_exists
    assert called["args"] == ("abc123", "thumbnails")


@pytest.mark.asyncio
async def test_async_delete_processed_folder_uses_to_thread(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service = StorageService.__new__(StorageService)

    called = {}

    async def fake_to_thread(func, *args):
        called["func"] = func
        called["args"] = args
        return None

    monkeypatch.setattr("app.services.storage_service.asyncio.to_thread", fake_to_thread)

    await service.async_delete_processed_folder("hash-123")

    assert called["func"] == service.delete_processed_folder
    assert called["args"] == ("hash-123",)
