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
