"""
Tests for cronless extraction recovery.

Covers:
- WorkerSettings has no periodic cron_jobs (no idle DB polling) and keeps
  retry/timeout bounds.
- Per-resource recovery flag computation (_recovery_flags).
- _attach_recovery_state only probes Redis within the request scope and never
  treats Redis as truth.
- The extract/resume endpoint re-queues via the idempotent prepare_extraction
  job using a deterministic (dedupe) job id.
"""

from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, Mock

import pytest

from app.api.v1 import resources as resources_api
from app.api.v1.resources import (
    _attach_recovery_state,
    _recovery_flags,
    trigger_extraction,
)
from app.models import Resource, User, UserResource
from app.models.resource import ExtractionStatus
from app.schemas.resource import ResourceRead
from app.workers import extraction_worker
from app.workers.extraction_worker import WorkerSettings


class _ScalarResult:
    def __init__(self, value):
        self._value = value

    def scalar_one_or_none(self):
        return self._value


def _make_resource(status: ExtractionStatus, resource_id: int = 1) -> Resource:
    return Resource(
        id=resource_id,
        content_hash="a" * 64,
        size_bytes=123,
        page_count=3,
        file_name="doc.pdf",
        is_public=False,
        extraction_status=status,
        uploaded_by=1,
    )


def _make_read(status: ExtractionStatus, resource_id: int = 1) -> ResourceRead:
    return ResourceRead(
        id=resource_id,
        content_hash="a" * 64,
        name="doc",
        size_bytes=123,
        page_count=3,
        is_public=False,
        extraction_status=status,
        uploaded_at="2025-01-01T00:00:00Z",
        processed_at=None,
        is_owner=True,
    )


# --- WorkerSettings: cronless + retry/timeout bounds ---


def test_worker_settings_has_no_cron_jobs() -> None:
    # No periodic cron jobs => no idle DB polling.
    assert getattr(WorkerSettings, "cron_jobs", None) in (None, [])


def test_worker_settings_has_retry_and_timeout_bounds() -> None:
    assert WorkerSettings.max_tries >= 1
    assert WorkerSettings.job_timeout > 0


def test_startup_recovery_still_wired() -> None:
    # Recovery functions remain available and run at startup (not via cron).
    assert WorkerSettings.on_startup is extraction_worker.on_worker_startup
    assert callable(extraction_worker.check_stale_extractions)
    assert callable(extraction_worker.check_orphan_resources)
    assert callable(extraction_worker.recover_incomplete_extractions)


def test_deterministic_job_ids() -> None:
    assert extraction_worker._prepare_job_id(7) == "glot:prepare:7"
    assert extraction_worker._extract_page_job_id(7, 3) == "glot:extract:7:3"


# --- _recovery_flags ---


@pytest.mark.parametrize(
    "status,progress,expected",
    [
        (ExtractionStatus.FAILED, None, (True, True)),
        (ExtractionStatus.PROCESSING, None, (True, True)),  # stale, no signal
        (ExtractionStatus.PENDING, None, (True, True)),  # stale, no signal
        (
            ExtractionStatus.PROCESSING,
            {"progress": 40, "updated_at": datetime.now(UTC).isoformat()},
            (False, False),
        ),  # live
        (
            ExtractionStatus.PENDING,
            {"progress": 0, "updated_at": datetime.now(UTC).isoformat()},
            (False, False),
        ),  # live
        (
            ExtractionStatus.PROCESSING,
            {
                "progress": 40,
                "updated_at": (datetime.now(UTC) - timedelta(minutes=30)).isoformat(),
            },
            (True, True),
        ),  # stale signal
        (ExtractionStatus.NONE, None, (False, False)),
        (ExtractionStatus.COMPLETED, None, (False, False)),
    ],
)
def test_recovery_flags(status, progress, expected) -> None:
    assert _recovery_flags(status, progress) == expected


# --- _attach_recovery_state ---


@pytest.mark.asyncio
async def test_attach_recovery_state_flags_stale_processing(monkeypatch) -> None:
    read = _make_read(ExtractionStatus.PROCESSING)
    resource = _make_resource(ExtractionStatus.PROCESSING)

    class FakeRedis:
        def __init__(self, _url):
            pass

        async def connect(self):
            return None

        async def get_progress(self, _id):
            return None  # no active progress signal -> stale

        async def close(self):
            return None

    monkeypatch.setattr(resources_api, "RedisService", FakeRedis)

    await _attach_recovery_state([(read, resource)])

    assert read.extraction_problem is True
    assert read.can_resume_extraction is True


@pytest.mark.asyncio
async def test_attach_recovery_state_live_processing(monkeypatch) -> None:
    read = _make_read(ExtractionStatus.PROCESSING)
    resource = _make_resource(ExtractionStatus.PROCESSING)

    class FakeRedis:
        def __init__(self, _url):
            pass

        async def connect(self):
            return None

        async def get_progress(self, _id):
            return {"progress": 50, "updated_at": datetime.now(UTC).isoformat()}

        async def close(self):
            return None

    monkeypatch.setattr(resources_api, "RedisService", FakeRedis)

    await _attach_recovery_state([(read, resource)])

    assert read.extraction_problem is False
    assert read.can_resume_extraction is False


@pytest.mark.asyncio
async def test_attach_recovery_state_skips_redis_when_no_active(monkeypatch) -> None:
    read = _make_read(ExtractionStatus.COMPLETED)
    resource = _make_resource(ExtractionStatus.COMPLETED)

    def _boom(_url):
        raise AssertionError("Redis must not be contacted for non-active resources")

    monkeypatch.setattr(resources_api, "RedisService", _boom)

    await _attach_recovery_state([(read, resource)])

    assert read.extraction_problem is False
    assert read.can_resume_extraction is False


# --- extract/resume endpoint re-queues via prepare_extraction (dedupe id) ---


@pytest.mark.asyncio
async def test_trigger_extraction_requeues_with_deterministic_job_id(monkeypatch) -> None:
    resource = _make_resource(ExtractionStatus.PROCESSING, resource_id=5)
    current_user = User(
        id=1,
        email="user@example.com",
        password_hash="hashed",
        is_active=True,
    )
    user_resource = UserResource(user_id=1, resource_id=5, name="doc")

    session = AsyncMock()
    session.get.return_value = resource
    session.execute.return_value = _ScalarResult(user_resource)

    enqueue_calls = []
    progress_calls = []

    class FakeRedis:
        def __init__(self, _url):
            pass

        async def enqueue_job(self, fn, *args, **kwargs):
            enqueue_calls.append((fn, args, kwargs))
            return "job-123"

        async def set_progress(self, resource_id, **kwargs):
            progress_calls.append((resource_id, kwargs))

        async def close(self):
            return None

    monkeypatch.setattr(resources_api, "RedisService", FakeRedis)
    monkeypatch.setattr(
        resources_api,
        "get_settings",
        lambda: Mock(redis_url="redis://example"),
    )

    result = await trigger_extraction(
        resource_id=5,
        session=session,
        current_user=current_user,
    )

    assert result["resource_id"] == 5
    assert result["job_id"] == "job-123"
    assert len(enqueue_calls) == 1
    fn, args, kwargs = enqueue_calls[0]
    assert fn == "prepare_extraction"
    assert args == (5,)
    # Deterministic dedupe id, not ARQ queue introspection.
    assert kwargs.get("_job_id") == "glot:prepare:5"
    assert progress_calls == [
        (
            5,
            {
                "status": "pending",
                "progress": 0,
                "current_page": None,
                "total_pages": 3,
            },
        )
    ]
