"""The health endpoint and FastAPI metadata must report the real app version.

Regression guard: a stale APP_VERSION environment variable (present on the
production VPS) used to override the code default via pydantic-settings, so
/health reported 0.1.0 on a 0.3.5 deployment. The version is release-managed
(x-release-please-version marker) and must ignore the environment.
"""

import asyncio
import tomllib
from pathlib import Path

import httpx
import pytest

from app.core import Settings, get_settings

BACKEND_DIR = Path(__file__).resolve().parents[1]


def _pyproject_version() -> str:
    with (BACKEND_DIR / "pyproject.toml").open("rb") as f:
        return tomllib.load(f)["project"]["version"]


def test_settings_app_version_matches_pyproject():
    assert get_settings().app_version == _pyproject_version()


def test_app_version_ignores_env_override(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("APP_VERSION", "9.9.9")
    settings = Settings(_env_file=None)
    assert settings.app_version != "9.9.9"
    assert settings.app_version == _pyproject_version()


def test_health_endpoint_reports_real_version():
    from app.main import app

    async def call_health() -> httpx.Response:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(
            transport=transport, base_url="http://test"
        ) as client:
            return await client.get("/health")

    response = asyncio.run(call_health())
    assert response.status_code == 200
    assert response.json()["version"] == _pyproject_version()
