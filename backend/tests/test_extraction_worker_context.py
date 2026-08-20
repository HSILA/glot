from types import SimpleNamespace

import pytest

from app.workers import extraction_worker


@pytest.mark.asyncio
async def test_worker_startup_initializes_and_reuses_ctx_services(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = SimpleNamespace(
        redis_url="redis://example",
        openrouter_api_key="key",
    )
    app_config = SimpleNamespace(extraction=SimpleNamespace(agent_model="model"))

    calls = {"redis": 0, "storage": 0, "agent": 0, "redis_connect": 0}

    class FakeRedisService:
        def __init__(self, _url: str) -> None:
            calls["redis"] += 1

        async def connect(self) -> None:
            calls["redis_connect"] += 1

        async def close(self) -> None:
            return None

    class FakeStorageService:
        def __init__(self, _settings) -> None:
            calls["storage"] += 1

    class FakeExtractionAgent:
        def __init__(self, *, api_key: str, model_id: str) -> None:
            assert api_key == "key"
            assert model_id == "model"
            calls["agent"] += 1

    async def _ok(_ctx: dict):
        return {}

    monkeypatch.setattr(extraction_worker, "get_settings", lambda: settings)
    monkeypatch.setattr(extraction_worker, "get_app_config", lambda: app_config)
    monkeypatch.setattr(extraction_worker, "RedisService", FakeRedisService)
    monkeypatch.setattr(extraction_worker, "StorageService", FakeStorageService)
    monkeypatch.setattr(extraction_worker, "ExtractionAgent", FakeExtractionAgent)
    monkeypatch.setattr(extraction_worker, "check_stale_extractions", _ok)
    monkeypatch.setattr(extraction_worker, "check_orphan_resources", _ok)
    monkeypatch.setattr(extraction_worker, "recover_incomplete_extractions", _ok)

    ctx: dict = {}
    await extraction_worker.on_worker_startup(ctx)

    assert calls == {"redis": 1, "storage": 1, "agent": 1, "redis_connect": 1}

    # Normal path reuse (no per-job recreation)
    await extraction_worker._get_or_init_redis(ctx)
    extraction_worker._get_or_init_storage(ctx)
    extraction_worker._get_or_init_extraction_agent(ctx)

    assert calls == {"redis": 1, "storage": 1, "agent": 1, "redis_connect": 1}


@pytest.mark.asyncio
async def test_worker_shutdown_closes_and_clears_ctx() -> None:
    closed = {"redis": 0}

    class FakeRedis:
        async def close(self) -> None:
            closed["redis"] += 1

    ctx = {
        "redis": FakeRedis(),
        "storage": object(),
        "settings": object(),
        "extraction_agent": object(),
    }

    await extraction_worker.on_worker_shutdown(ctx)

    assert closed["redis"] == 1
    assert ctx == {}


def test_extraction_agent_cached_per_worker_ctx(monkeypatch: pytest.MonkeyPatch) -> None:
    settings = SimpleNamespace(
        openrouter_api_key="key",
    )
    app_config = SimpleNamespace(extraction=SimpleNamespace(agent_model="model"))
    init_calls = {"agent": 0}

    class FakeAgent:
        def __init__(self, *, api_key: str, model_id: str) -> None:
            assert api_key == "key"
            assert model_id == "model"
            init_calls["agent"] += 1

    monkeypatch.setattr(extraction_worker, "get_settings", lambda: settings)
    monkeypatch.setattr(extraction_worker, "get_app_config", lambda: app_config)
    monkeypatch.setattr(extraction_worker, "ExtractionAgent", FakeAgent)

    ctx: dict = {}
    first = extraction_worker._get_or_init_extraction_agent(ctx)
    second = extraction_worker._get_or_init_extraction_agent(ctx)

    assert first is second
    assert init_calls["agent"] == 1
