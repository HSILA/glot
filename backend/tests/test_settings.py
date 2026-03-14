import pytest
from pydantic import ValidationError

from app.core import Settings

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


def test_database_pool_settings_defaults(monkeypatch):
    _set_required_env(monkeypatch)
    monkeypatch.setenv("JWT_SECRET", "super-secret-test-value")

    settings = Settings(_env_file=None)

    assert settings.database_pool_pre_ping is True
    assert settings.database_pool_recycle == 1800
    assert settings.database_pool_size == 10
    assert settings.database_max_overflow == 20
    assert settings.database_pool_timeout == 30.0
    assert settings.database_use_null_pool is False


def test_database_pool_settings_env_overrides(monkeypatch):
    _set_required_env(monkeypatch)
    monkeypatch.setenv("JWT_SECRET", "super-secret-test-value")
    monkeypatch.setenv("DATABASE_POOL_PRE_PING", "false")
    monkeypatch.setenv("DATABASE_POOL_RECYCLE", "600")
    monkeypatch.setenv("DATABASE_POOL_SIZE", "6")
    monkeypatch.setenv("DATABASE_MAX_OVERFLOW", "12")
    monkeypatch.setenv("DATABASE_POOL_TIMEOUT", "9.5")
    monkeypatch.setenv("DATABASE_USE_NULL_POOL", "true")

    settings = Settings(_env_file=None)

    assert settings.database_pool_pre_ping is False
    assert settings.database_pool_recycle == 600
    assert settings.database_pool_size == 6
    assert settings.database_max_overflow == 12
    assert settings.database_pool_timeout == 9.5
    assert settings.database_use_null_pool is True
