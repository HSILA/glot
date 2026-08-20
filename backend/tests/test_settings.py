import pytest
from pydantic import ValidationError

from app.core import Settings
from app.core.app_config import load_app_config

REQUIRED_ENV = {
    "R2_ACCOUNT_ID": "test-account",
    "R2_ACCESS_KEY_ID": "test-key",
    "R2_SECRET_ACCESS_KEY": "test-secret",
    "R2_BUCKET_NAME": "test-bucket",
    "OPENROUTER_API_KEY": "test-openrouter-key",
}


def _set_required_env(monkeypatch):
    for key, value in REQUIRED_ENV.items():
        monkeypatch.setenv(key, value)


def test_settings_require_jwt_secret(monkeypatch):
    _set_required_env(monkeypatch)
    monkeypatch.delenv("JWT_SECRET", raising=False)

    with pytest.raises(ValidationError):
        Settings(_env_file=None)


def test_settings_reject_blank_jwt_secret(monkeypatch):
    _set_required_env(monkeypatch)
    monkeypatch.setenv("JWT_SECRET", "   ")

    with pytest.raises(ValidationError, match="JWT_SECRET must not be blank"):
        Settings(_env_file=None)


def test_settings_accept_valid_jwt_secret(monkeypatch):
    _set_required_env(monkeypatch)
    monkeypatch.setenv("JWT_SECRET", "super-secret-test-value")

    settings = Settings(_env_file=None)

    assert settings.jwt_secret == "super-secret-test-value"


def test_settings_only_owns_database_use_null_pool(monkeypatch):
    _set_required_env(monkeypatch)
    monkeypatch.setenv("JWT_SECRET", "super-secret-test-value")

    settings = Settings(_env_file=None)

    assert settings.database_use_null_pool is False

    moved_fields = {
        "database_pool_pre_ping",
        "database_pool_recycle",
        "database_pool_size",
        "database_max_overflow",
        "database_pool_timeout",
    }
    assert moved_fields.isdisjoint(Settings.model_fields)


def test_database_pool_yaml_values_cannot_be_overridden_by_env(monkeypatch):
    _set_required_env(monkeypatch)
    monkeypatch.setenv("JWT_SECRET", "super-secret-test-value")
    monkeypatch.setenv("DATABASE_POOL_PRE_PING", "false")
    monkeypatch.setenv("DATABASE_POOL_RECYCLE", "600")
    monkeypatch.setenv("DATABASE_POOL_SIZE", "6")
    monkeypatch.setenv("DATABASE_MAX_OVERFLOW", "12")
    monkeypatch.setenv("DATABASE_POOL_TIMEOUT", "9.5")
    monkeypatch.setenv("DATABASE_USE_NULL_POOL", "true")

    settings = Settings(_env_file=None)
    database_pool = load_app_config().database_pool

    assert database_pool.pre_ping is True
    assert database_pool.recycle_seconds == 1800
    assert database_pool.size == 10
    assert database_pool.max_overflow == 20
    assert database_pool.timeout_seconds == 30
    assert settings.database_use_null_pool is True
