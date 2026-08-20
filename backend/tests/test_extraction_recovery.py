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


# --- sweep_expired_uploads (cronless startup reclaim of abandoned uploads) ---


def _unconfirmed_upload(resource_id: int = 41) -> Resource:
    # An abandoned, never-confirmed upload reservation. uploaded_at is old
    # enough that the SQL predicate would have selected it.
    return Resource(
        id=resource_id,
        content_hash="b" * 64,
        size_bytes=512,
        upload_confirmed=False,
        page_count=None,
        file_name="doc.pdf",
        is_public=False,
        extraction_status=ExtractionStatus.NONE,
        uploaded_at=datetime(2020, 1, 1, tzinfo=UTC),
        uploaded_by=1,
    )


class _FakeSessionFactory:
    """Async session factory that returns an async CM yielding a fake session."""

    def __init__(self, session):
        self._session = session

    def __call__(self):
        return self

    async def __aenter__(self):
        return self._session

    async def __aexit__(self, *_exc):
        return False


def _startup_ctx(storage) -> dict:
    # Supplying a storage object in the ctx avoids initializing a real one.
    return {"storage": storage}


def _result(values) -> Mock:
    r = Mock()
    r.scalars.return_value.all.return_value = values
    return r


def _storage(list_keys=None):
    storage = Mock()
    storage.async_delete_file = AsyncMock()
    storage.async_list_object_keys = AsyncMock(
        return_value=list_keys or []
    )
    return storage


def _sweep_session(executes):
    """Build a session for sweep tests.

    ``executes`` is the ordered list of result values for each ``session.execute``
    call (step-1 candidate select, step-1 delete(UserResource) rows, then the
    step-2 batched id-resolution query).
    """
    session = AsyncMock()
    session.execute.side_effect = [_result(v) for v in executes]
    return session


@pytest.mark.asyncio
async def test_sweep_expired_uploads_reclaims_abandoned_uploads(monkeypatch) -> None:
    resource = _unconfirmed_upload()
    # Executes: step-1 candidate select, then delete(UserResource) for the sweep.
    session = _sweep_session([[resource], []])
    storage = _storage()  # no leftover staging objects

    monkeypatch.setattr(
        extraction_worker,
        "async_session_factory",
        _FakeSessionFactory(session),
    )

    outcome = await extraction_worker.sweep_expired_uploads(_startup_ctx(storage))

    assert outcome == {"swept": 1, "staging_cleaned": 0}
    # Staging object reclaimed, rows removed, and the lock transaction commits
    # (even when step 2 finds nothing) so FOR UPDATE locks are released.
    storage.async_delete_file.assert_awaited_once_with("uploads/41.pdf", folder=None)
    session.delete.assert_awaited_once_with(resource)
    session.commit.assert_awaited()


@pytest.mark.asyncio
async def test_sweep_expired_uploads_skips_confirmed_resources(monkeypatch) -> None:
    resource = _unconfirmed_upload()
    resource.upload_confirmed = True  # a confirm won the race to the row lock
    session = _sweep_session([[resource]])
    storage = _storage()

    monkeypatch.setattr(
        extraction_worker,
        "async_session_factory",
        _FakeSessionFactory(session),
    )

    outcome = await extraction_worker.sweep_expired_uploads(_startup_ctx(storage))

    assert outcome == {"swept": 0, "staging_cleaned": 0}
    storage.async_delete_file.assert_not_awaited()
    session.delete.assert_not_awaited()
    # Lock-releasing commit still runs.
    session.commit.assert_awaited()


@pytest.mark.asyncio
async def test_sweep_expired_uploads_cleans_confirmed_staging(monkeypatch) -> None:
    confirmed = _unconfirmed_upload(resource_id=77)
    confirmed.upload_confirmed = True  # confirmed; only its staging is garbage
    # Step 1 finds no expired reservations; step 2 finds the confirmed staging
    # object in storage and resolves it to the confirmed row.
    session = _sweep_session([[], [confirmed]])
    storage = _storage(list_keys=["uploads/77.pdf"])

    monkeypatch.setattr(
        extraction_worker,
        "async_session_factory",
        _FakeSessionFactory(session),
    )

    outcome = await extraction_worker.sweep_expired_uploads(_startup_ctx(storage))

    assert outcome == {"swept": 0, "staging_cleaned": 1}
    # Confirmed resources keep their rows but drop the dead staging object.
    storage.async_delete_file.assert_awaited_once_with("uploads/77.pdf", folder=None)
    session.delete.assert_not_awaited()


@pytest.mark.asyncio
async def test_sweep_expired_uploads_deletes_orphaned_staging(monkeypatch) -> None:
    # A staging object exists with NO matching resource row -> orphan, deleted.
    session = _sweep_session([[], []])  # id-resolution returns nothing
    storage = _storage(list_keys=["uploads/88.pdf"])

    monkeypatch.setattr(
        extraction_worker,
        "async_session_factory",
        _FakeSessionFactory(session),
    )

    outcome = await extraction_worker.sweep_expired_uploads(_startup_ctx(storage))

    assert outcome == {"swept": 0, "staging_cleaned": 1}
    storage.async_delete_file.assert_awaited_once_with("uploads/88.pdf", folder=None)


@pytest.mark.asyncio
async def test_sweep_expired_uploads_leaves_recent_confirmed_staging(monkeypatch) -> None:
    # A confirmed resource whose upload is still within the window must NOT be
    # cleaned; its staging may still be in use by a concurrent request.
    recent = _unconfirmed_upload(resource_id=99)
    recent.upload_confirmed = True
    recent.uploaded_at = datetime.now(UTC) - timedelta(minutes=1)  # too recent
    session = _sweep_session([[], [recent]])
    storage = _storage(list_keys=["uploads/99.pdf"])

    monkeypatch.setattr(
        extraction_worker,
        "async_session_factory",
        _FakeSessionFactory(session),
    )

    outcome = await extraction_worker.sweep_expired_uploads(_startup_ctx(storage))

    assert outcome == {"swept": 0, "staging_cleaned": 0}
    storage.async_delete_file.assert_not_awaited()


@pytest.mark.asyncio
async def test_sweep_expired_uploads_is_noop_without_candidates(monkeypatch) -> None:
    session = _sweep_session([[]])
    storage = _storage()

    monkeypatch.setattr(
        extraction_worker,
        "async_session_factory",
        _FakeSessionFactory(session),
    )

    outcome = await extraction_worker.sweep_expired_uploads(_startup_ctx(storage))

    assert outcome == {"swept": 0, "staging_cleaned": 0}
    session.delete.assert_not_awaited()
    session.commit.assert_awaited()


@pytest.mark.asyncio
async def test_sweep_expired_uploads_skips_on_staging_delete_failure(monkeypatch) -> None:
    resource = _unconfirmed_upload()
    session = _sweep_session([[resource]])
    storage = _storage()
    storage.async_delete_file = AsyncMock(side_effect=RuntimeError("R2 unavailable"))

    monkeypatch.setattr(
        extraction_worker,
        "async_session_factory",
        _FakeSessionFactory(session),
    )

    outcome = await extraction_worker.sweep_expired_uploads(_startup_ctx(storage))

    # If the object can't be deleted, the row is left behind so a later sweep
    # retries; deleting the row would orphan the object unreachably.
    assert outcome == {"swept": 0, "staging_cleaned": 0}
    session.delete.assert_not_awaited()
    session.commit.assert_awaited()


def test_sweep_expired_uploads_is_wired_at_startup() -> None:
    import inspect

    source = inspect.getsource(extraction_worker.on_worker_startup)
    # The sweeper must actually be invoked on startup, not merely be importable.
    assert "sweep_expired_uploads(ctx)" in source


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
