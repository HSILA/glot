"""
Tests for the canonical, version-controlled app-wide configuration.

The config lives in a committed YAML file (backend/config/app.yaml) and is the
single source of truth for values that apply globally rather than per-request
or per-secret. There are no behavioral fallback defaults and no environment
overrides: a missing or invalid file must fail loudly at startup rather than
silently applying a wrong value (e.g. a wrong scheduling cap, a wrong token
lifetime, a wrong rate limit).
"""

import copy

import pytest
import yaml
from pydantic import ValidationError

from app.core.app_config import (
    DEFAULT_APP_CONFIG_PATH,
    MAX_ALLOWED_INTERVAL_DAYS,
    AppConfigError,
    get_app_config,
    load_app_config,
)

# Mirrors the committed backend/config/app.yaml exactly. Kept in sync with the
# "committed values" assertions below.
VALID_CONFIG: dict = {
    "version": 1,
    "scheduling": {
        "maximum_interval_days": 90,
        "enable_fuzz": True,
    },
    "auth": {
        "jwt_algorithm": "HS256",
        "access_token_expire_minutes": 30,
        "refresh_token_expire_days": 14,
    },
    "resources": {
        "max_size_bytes": 78643200,
        "max_files_per_user": 10,
        "allowed_types": ["application/pdf"],
    },
    "extraction": {
        "agent_model": "qwen/qwen3-vl-235b-a22b-instruct",
        "worker_poll_delay_seconds": 15,
    },
    "database_pool": {
        "pre_ping": True,
        "recycle_seconds": 1800,
        "size": 10,
        "max_overflow": 20,
        "timeout_seconds": 30,
    },
    "rate_limits": {
        "login": "5/5minutes",
        "register": "3/hour",
        "refresh": "10/minute",
    },
}


def valid_config() -> dict:
    return copy.deepcopy(VALID_CONFIG)


def write_config(tmp_path, data):
    path = tmp_path / "app.yaml"
    if isinstance(data, str):
        path.write_text(data, encoding="utf-8")
    else:
        path.write_text(yaml.safe_dump(data), encoding="utf-8")
    return path


# --- The committed repository config -----------------------------------------


def test_repository_config_file_is_committed_and_loadable():
    assert DEFAULT_APP_CONFIG_PATH.is_file()

    config = load_app_config()

    assert config.version == 1


def test_committed_scheduling_section():
    config = load_app_config()

    assert config.scheduling.maximum_interval_days == 90
    assert config.scheduling.enable_fuzz is True


def test_committed_auth_section():
    config = load_app_config()

    assert config.auth.jwt_algorithm == "HS256"
    assert config.auth.access_token_expire_minutes == 30
    assert config.auth.refresh_token_expire_days == 14


def test_committed_resources_section():
    config = load_app_config()

    assert config.resources.max_size_bytes == 78643200
    assert config.resources.max_files_per_user == 10
    assert config.resources.allowed_types == ["application/pdf"]


def test_committed_extraction_section():
    config = load_app_config()

    assert config.extraction.agent_model == "qwen/qwen3-vl-235b-a22b-instruct"
    assert config.extraction.worker_poll_delay_seconds == 15


def test_committed_database_pool_section():
    config = load_app_config()

    assert config.database_pool.pre_ping is True
    assert config.database_pool.recycle_seconds == 1800
    assert config.database_pool.size == 10
    assert config.database_pool.max_overflow == 20
    assert config.database_pool.timeout_seconds == 30


def test_committed_rate_limits_section():
    config = load_app_config()

    assert config.rate_limits.login == "5/5minutes"
    assert config.rate_limits.register_limit == "3/hour"
    assert config.rate_limits.refresh == "10/minute"


def test_get_app_config_returns_committed_config():
    config = get_app_config()

    assert config.scheduling.maximum_interval_days == 90


def test_get_app_config_is_cached():
    assert get_app_config() is get_app_config()


# --- Loading a valid file -----------------------------------------------------


def test_loads_explicit_path(tmp_path):
    path = write_config(tmp_path, valid_config())

    config = load_app_config(path)

    assert config.scheduling.maximum_interval_days == 90
    assert config.auth.jwt_algorithm == "HS256"
    assert config.resources.max_files_per_user == 10
    assert config.extraction.worker_poll_delay_seconds == 15
    assert config.database_pool.size == 10
    assert config.rate_limits.login == "5/5minutes"


def test_config_is_immutable(tmp_path):
    config = load_app_config(write_config(tmp_path, valid_config()))

    with pytest.raises(ValidationError):
        config.version = 2


def test_scheduling_section_is_immutable(tmp_path):
    config = load_app_config(write_config(tmp_path, valid_config()))

    with pytest.raises(ValidationError):
        config.scheduling.maximum_interval_days = 365


def test_auth_section_is_immutable(tmp_path):
    config = load_app_config(write_config(tmp_path, valid_config()))

    with pytest.raises(ValidationError):
        config.auth.jwt_algorithm = "RS256"


def test_string_version_rejected(tmp_path):
    data = valid_config()
    data["version"] = "1"
    path = write_config(tmp_path, data)

    with pytest.raises(AppConfigError, match="version"):
        load_app_config(path)


# --- Missing / malformed file --------------------------------------------------


def test_missing_file_raises_clear_error(tmp_path):
    missing = tmp_path / "does-not-exist.yaml"

    with pytest.raises(AppConfigError, match="not found"):
        load_app_config(missing)


def test_missing_file_error_mentions_path(tmp_path):
    missing = tmp_path / "does-not-exist.yaml"

    with pytest.raises(AppConfigError, match=str(missing)):
        load_app_config(missing)


def test_malformed_yaml_raises_clear_error(tmp_path):
    path = write_config(tmp_path, "version: 1\nscheduling: [unclosed\n")

    with pytest.raises(AppConfigError, match="not valid YAML"):
        load_app_config(path)


def test_empty_file_raises_clear_error(tmp_path):
    path = write_config(tmp_path, "")

    with pytest.raises(AppConfigError, match="mapping"):
        load_app_config(path)


@pytest.mark.parametrize(
    "content",
    [
        "- version: 1\n",  # list
        "just a string\n",  # scalar/string
        "42\n",  # scalar/int
    ],
)
def test_non_mapping_root_raises_clear_error(tmp_path, content):
    path = write_config(tmp_path, content)

    with pytest.raises(AppConfigError, match="mapping"):
        load_app_config(path)


# --- Unknown fields -------------------------------------------------------------


def test_unknown_top_level_section_rejected(tmp_path):
    data = valid_config()
    data["extra_section"] = {"foo": "bar"}
    path = write_config(tmp_path, data)

    with pytest.raises(AppConfigError, match="extra_section"):
        load_app_config(path)


@pytest.mark.parametrize(
    "section,field",
    [
        ("scheduling", "desired_retention"),
        ("auth", "jwt_secret"),
        ("resources", "resource_allowed_extensions"),
        ("extraction", "temperature"),
        ("database_pool", "echo"),
        ("rate_limits", "logout"),
    ],
)
def test_unknown_field_in_section_rejected(tmp_path, section, field):
    data = valid_config()
    data[section][field] = "unexpected"
    path = write_config(tmp_path, data)

    with pytest.raises(AppConfigError, match=field):
        load_app_config(path)


# --- Missing sections / fields ---------------------------------------------------


def test_missing_version_rejected(tmp_path):
    data = valid_config()
    del data["version"]
    path = write_config(tmp_path, data)

    with pytest.raises(AppConfigError, match="version"):
        load_app_config(path)


@pytest.mark.parametrize(
    "section",
    ["scheduling", "auth", "resources", "extraction", "database_pool", "rate_limits"],
)
def test_missing_section_rejected(tmp_path, section):
    data = valid_config()
    del data[section]
    path = write_config(tmp_path, data)

    with pytest.raises(AppConfigError, match=section):
        load_app_config(path)


@pytest.mark.parametrize(
    "section,field",
    [
        ("scheduling", "maximum_interval_days"),
        ("scheduling", "enable_fuzz"),
        ("auth", "jwt_algorithm"),
        ("auth", "access_token_expire_minutes"),
        ("auth", "refresh_token_expire_days"),
        ("resources", "max_size_bytes"),
        ("resources", "max_files_per_user"),
        ("resources", "allowed_types"),
        ("extraction", "agent_model"),
        ("extraction", "worker_poll_delay_seconds"),
        ("database_pool", "pre_ping"),
        ("database_pool", "recycle_seconds"),
        ("database_pool", "size"),
        ("database_pool", "max_overflow"),
        ("database_pool", "timeout_seconds"),
        ("rate_limits", "login"),
        ("rate_limits", "register"),
        ("rate_limits", "refresh"),
    ],
)
def test_missing_field_rejected(tmp_path, section, field):
    data = valid_config()
    del data[section][field]
    path = write_config(tmp_path, data)

    with pytest.raises(AppConfigError, match=field):
        load_app_config(path)


# --- Wrong strict types -----------------------------------------------------------


@pytest.mark.parametrize(
    "section,field,value",
    [
        ("scheduling", "maximum_interval_days", "90"),
        ("scheduling", "maximum_interval_days", 90.5),
        ("scheduling", "enable_fuzz", 1),
        ("scheduling", "enable_fuzz", "true"),
        ("auth", "jwt_algorithm", 256),
        ("auth", "access_token_expire_minutes", "30"),
        ("auth", "refresh_token_expire_days", "14"),
        ("resources", "max_size_bytes", "78643200"),
        ("resources", "max_files_per_user", 10.5),
        ("resources", "allowed_types", "application/pdf"),
        ("extraction", "agent_model", 123),
        ("extraction", "worker_poll_delay_seconds", "15"),
        ("database_pool", "pre_ping", "true"),
        ("database_pool", "recycle_seconds", 1800.0),
        ("database_pool", "size", "10"),
        ("database_pool", "max_overflow", "20"),
        ("database_pool", "timeout_seconds", "30"),
        ("rate_limits", "login", 5),
        ("rate_limits", "register", None),
    ],
)
def test_wrong_strict_type_rejected(tmp_path, section, field, value):
    data = valid_config()
    data[section][field] = value
    path = write_config(tmp_path, data)

    with pytest.raises(AppConfigError, match=field):
        load_app_config(path)


# --- Invalid bounds ----------------------------------------------------------------


@pytest.mark.parametrize("value", [0, -1])
def test_non_positive_maximum_interval_rejected(tmp_path, value):
    data = valid_config()
    data["scheduling"]["maximum_interval_days"] = value
    path = write_config(tmp_path, data)

    with pytest.raises(AppConfigError, match="maximum_interval_days"):
        load_app_config(path)


def test_maximum_interval_above_cap_rejected(tmp_path):
    data = valid_config()
    data["scheduling"]["maximum_interval_days"] = MAX_ALLOWED_INTERVAL_DAYS + 1
    path = write_config(tmp_path, data)

    with pytest.raises(AppConfigError, match="maximum_interval_days"):
        load_app_config(path)


def test_maximum_interval_at_cap_accepted(tmp_path):
    data = valid_config()
    data["scheduling"]["maximum_interval_days"] = MAX_ALLOWED_INTERVAL_DAYS
    path = write_config(tmp_path, data)

    config = load_app_config(path)

    assert config.scheduling.maximum_interval_days == MAX_ALLOWED_INTERVAL_DAYS


@pytest.mark.parametrize(
    "section,field,value",
    [
        ("auth", "access_token_expire_minutes", 0),
        ("auth", "refresh_token_expire_days", 0),
        ("resources", "max_size_bytes", 0),
        ("resources", "max_files_per_user", 0),
        ("extraction", "worker_poll_delay_seconds", -1),
        ("database_pool", "recycle_seconds", 0),
        ("database_pool", "size", 0),
        ("database_pool", "max_overflow", -1),
        ("database_pool", "timeout_seconds", 0),
    ],
)
def test_out_of_bounds_numeric_field_rejected(tmp_path, section, field, value):
    data = valid_config()
    data[section][field] = value
    path = write_config(tmp_path, data)

    with pytest.raises(AppConfigError, match=field):
        load_app_config(path)


def test_empty_allowed_types_rejected(tmp_path):
    data = valid_config()
    data["resources"]["allowed_types"] = []
    path = write_config(tmp_path, data)

    with pytest.raises(AppConfigError, match="allowed_types"):
        load_app_config(path)


@pytest.mark.parametrize(
    "allowed_types",
    [["text/plain"], ["application/pdf", "text/plain"], ["application/pdf", "application/pdf"]],
)
def test_unsupported_or_duplicate_allowed_types_rejected(tmp_path, allowed_types):
    data = valid_config()
    data["resources"]["allowed_types"] = allowed_types
    path = write_config(tmp_path, data)

    with pytest.raises(AppConfigError, match="allowed_types"):
        load_app_config(path)


def test_empty_jwt_algorithm_rejected(tmp_path):
    data = valid_config()
    data["auth"]["jwt_algorithm"] = ""
    path = write_config(tmp_path, data)

    with pytest.raises(AppConfigError, match="jwt_algorithm"):
        load_app_config(path)


@pytest.mark.parametrize("algorithm", ["BOGUS", "RS256", "HS512"])
def test_unsupported_jwt_algorithm_rejected(tmp_path, algorithm):
    data = valid_config()
    data["auth"]["jwt_algorithm"] = algorithm
    path = write_config(tmp_path, data)

    with pytest.raises(AppConfigError, match="jwt_algorithm"):
        load_app_config(path)


def test_worker_poll_delay_zero_accepted(tmp_path):
    data = valid_config()
    data["extraction"]["worker_poll_delay_seconds"] = 0
    path = write_config(tmp_path, data)

    config = load_app_config(path)

    assert config.extraction.worker_poll_delay_seconds == 0


def test_database_pool_max_overflow_zero_accepted(tmp_path):
    data = valid_config()
    data["database_pool"]["max_overflow"] = 0
    path = write_config(tmp_path, data)

    config = load_app_config(path)

    assert config.database_pool.max_overflow == 0


# --- Invalid rate limit formats ------------------------------------------------------


@pytest.mark.parametrize(
    "value",
    [
        "five/minute",
        "5-minute",
        "5/",
        "/minute",
        "5/minute5",
        "5/5 minutes",
        "",
        "5/day/extra",
        "5 per minute",
        "0/minute",
        "5/0minutes",
        "00/hour",
    ],
)
def test_invalid_rate_limit_format_rejected(tmp_path, value):
    data = valid_config()
    data["rate_limits"]["login"] = value
    path = write_config(tmp_path, data)

    with pytest.raises(AppConfigError, match="login"):
        load_app_config(path)


@pytest.mark.parametrize("value", ["5/minute", "5/5minutes", "1/second", "100/days"])
def test_valid_rate_limit_formats_accepted(tmp_path, value):
    data = valid_config()
    data["rate_limits"]["register"] = value
    path = write_config(tmp_path, data)

    config = load_app_config(path)

    assert config.rate_limits.register_limit == value


# --- Invalid version ------------------------------------------------------------------


@pytest.mark.parametrize("value", [0, 2, -1])
def test_unsupported_version_rejected(tmp_path, value):
    data = valid_config()
    data["version"] = value
    path = write_config(tmp_path, data)

    with pytest.raises(AppConfigError, match="version"):
        load_app_config(path)


# --- No competing environment source ---------------------------------------------------


def test_app_settings_no_longer_expose_moved_fields():
    """Values now owned by app.yaml must not be readable from environment settings."""
    from app.core import Settings

    moved_fields = {
        "maximum_interval_days",
        "enable_fuzz",
        "jwt_algorithm",
        "access_token_expire_minutes",
        "refresh_token_expire_days",
        "resource_max_size_bytes",
        "resource_max_files_per_user",
        "resource_allowed_types",
        "extraction_agent_model",
        "extraction_worker_poll_delay_seconds",
        "database_pool_pre_ping",
        "database_pool_recycle",
        "database_pool_size",
        "database_max_overflow",
        "database_pool_timeout",
    }

    assert moved_fields.isdisjoint(Settings.model_fields)


def test_environment_variables_cannot_override_config(monkeypatch):
    monkeypatch.setenv("MAXIMUM_INTERVAL_DAYS", "365")
    monkeypatch.setenv("ENABLE_FUZZ", "false")
    monkeypatch.setenv("JWT_ALGORITHM", "RS256")
    monkeypatch.setenv("ACCESS_TOKEN_EXPIRE_MINUTES", "999")
    monkeypatch.setenv("REFRESH_TOKEN_EXPIRE_DAYS", "999")
    monkeypatch.setenv("RESOURCE_MAX_SIZE_BYTES", "1")
    monkeypatch.setenv("RESOURCE_MAX_FILES_PER_USER", "1")
    monkeypatch.setenv("EXTRACTION_AGENT_MODEL", "some-other-model")
    monkeypatch.setenv("EXTRACTION_WORKER_POLL_DELAY_SECONDS", "1")
    monkeypatch.setenv("DATABASE_POOL_SIZE", "1")
    monkeypatch.setenv("RATE_LIMIT_LOGIN", "1000/second")

    config = load_app_config()

    assert config.scheduling.maximum_interval_days == 90
    assert config.scheduling.enable_fuzz is True
    assert config.auth.jwt_algorithm == "HS256"
    assert config.auth.access_token_expire_minutes == 30
    assert config.resources.max_size_bytes == 78643200
    assert config.extraction.agent_model == "qwen/qwen3-vl-235b-a22b-instruct"
    assert config.database_pool.size == 10
    assert config.rate_limits.login == "5/5minutes"
