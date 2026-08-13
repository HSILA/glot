"""
Tests for the canonical, version-controlled global scheduling policy.

The policy lives in a committed YAML file (backend/config/scheduling.yaml) and is
the single source of truth for global scheduling values. There are no behavioral
fallback defaults and no environment overrides: a missing or invalid file must
fail loudly at startup rather than silently scheduling cards with a wrong cap.
"""

import pytest
from pydantic import ValidationError

from app.core.scheduling import (
    DEFAULT_SCHEDULING_CONFIG_PATH,
    SchedulingConfigError,
    get_scheduling_policy,
    load_scheduling_config,
)


def write_config(tmp_path, content: str):
    path = tmp_path / "scheduling.yaml"
    path.write_text(content, encoding="utf-8")
    return path


VALID_CONFIG = """
version: 1
scheduling:
  maximum_interval_days: 90
  enable_fuzz: true
"""


# --- The committed repository policy -----------------------------------------


def test_repository_config_file_is_committed_and_loadable():
    assert DEFAULT_SCHEDULING_CONFIG_PATH.is_file()

    config = load_scheduling_config()

    assert config.version == 1
    assert config.scheduling.maximum_interval_days == 90
    assert config.scheduling.enable_fuzz is True


def test_get_scheduling_policy_returns_committed_policy():
    policy = get_scheduling_policy()

    assert policy.maximum_interval_days == 90


def test_get_scheduling_policy_is_cached():
    assert get_scheduling_policy() is get_scheduling_policy()


# --- Loading a valid file ----------------------------------------------------


def test_loads_explicit_path(tmp_path):
    path = write_config(tmp_path, VALID_CONFIG)

    config = load_scheduling_config(path)

    assert config.scheduling.maximum_interval_days == 90
    assert config.scheduling.enable_fuzz is True


def test_policy_is_immutable(tmp_path):
    config = load_scheduling_config(write_config(tmp_path, VALID_CONFIG))

    with pytest.raises(ValidationError):
        config.scheduling.maximum_interval_days = 365


def test_string_version_rejected(tmp_path):
    path = write_config(tmp_path, VALID_CONFIG.replace("version: 1", 'version: "1"'))

    with pytest.raises(SchedulingConfigError, match="version"):
        load_scheduling_config(path)


# --- Missing / malformed file ------------------------------------------------


def test_missing_file_raises_clear_error(tmp_path):
    missing = tmp_path / "does-not-exist.yaml"

    with pytest.raises(SchedulingConfigError, match="not found"):
        load_scheduling_config(missing)


def test_missing_file_error_mentions_path(tmp_path):
    missing = tmp_path / "does-not-exist.yaml"

    with pytest.raises(SchedulingConfigError, match=str(missing)):
        load_scheduling_config(missing)


def test_malformed_yaml_raises_clear_error(tmp_path):
    path = write_config(tmp_path, "version: 1\nscheduling: [unclosed\n")

    with pytest.raises(SchedulingConfigError, match="not valid YAML"):
        load_scheduling_config(path)


def test_empty_file_raises_clear_error(tmp_path):
    path = write_config(tmp_path, "")

    with pytest.raises(SchedulingConfigError, match="mapping"):
        load_scheduling_config(path)


def test_non_mapping_root_raises_clear_error(tmp_path):
    path = write_config(tmp_path, "- version: 1\n")

    with pytest.raises(SchedulingConfigError, match="mapping"):
        load_scheduling_config(path)


# --- Schema violations -------------------------------------------------------


def test_unknown_top_level_field_rejected(tmp_path):
    path = write_config(tmp_path, VALID_CONFIG + "extra_section: 1\n")

    with pytest.raises(SchedulingConfigError, match="extra_section"):
        load_scheduling_config(path)


def test_unknown_scheduling_field_rejected(tmp_path):
    path = write_config(tmp_path, VALID_CONFIG + "  desired_retention: 0.9\n")

    with pytest.raises(SchedulingConfigError, match="desired_retention"):
        load_scheduling_config(path)


def test_missing_version_rejected(tmp_path):
    path = write_config(
        tmp_path,
        "scheduling:\n  maximum_interval_days: 90\n  enable_fuzz: true\n",
    )

    with pytest.raises(SchedulingConfigError, match="version"):
        load_scheduling_config(path)


def test_unsupported_version_rejected(tmp_path):
    path = write_config(tmp_path, VALID_CONFIG.replace("version: 1", "version: 2"))

    with pytest.raises(SchedulingConfigError, match="version"):
        load_scheduling_config(path)


def test_missing_scheduling_section_rejected(tmp_path):
    path = write_config(tmp_path, "version: 1\n")

    with pytest.raises(SchedulingConfigError, match="scheduling"):
        load_scheduling_config(path)


def test_missing_maximum_interval_days_rejected(tmp_path):
    path = write_config(tmp_path, "version: 1\nscheduling:\n  enable_fuzz: true\n")

    with pytest.raises(SchedulingConfigError, match="maximum_interval_days"):
        load_scheduling_config(path)


def test_missing_enable_fuzz_rejected(tmp_path):
    path = write_config(
        tmp_path, "version: 1\nscheduling:\n  maximum_interval_days: 90\n"
    )

    with pytest.raises(SchedulingConfigError, match="enable_fuzz"):
        load_scheduling_config(path)


# --- Invalid values ----------------------------------------------------------


@pytest.mark.parametrize("value", ["0", "-1"])
def test_non_positive_maximum_interval_rejected(tmp_path, value):
    path = write_config(
        tmp_path, VALID_CONFIG.replace("maximum_interval_days: 90", f"maximum_interval_days: {value}")
    )

    with pytest.raises(SchedulingConfigError, match="maximum_interval_days"):
        load_scheduling_config(path)


@pytest.mark.parametrize("value", ['"90"', "90.5", "null", "true"])
def test_non_integer_maximum_interval_rejected(tmp_path, value):
    path = write_config(
        tmp_path, VALID_CONFIG.replace("maximum_interval_days: 90", f"maximum_interval_days: {value}")
    )

    with pytest.raises(SchedulingConfigError, match="maximum_interval_days"):
        load_scheduling_config(path)


@pytest.mark.parametrize("value", ['"true"', "1", "null"])
def test_non_boolean_enable_fuzz_rejected(tmp_path, value):
    path = write_config(
        tmp_path, VALID_CONFIG.replace("enable_fuzz: true", f"enable_fuzz: {value}")
    )

    with pytest.raises(SchedulingConfigError, match="enable_fuzz"):
        load_scheduling_config(path)


# --- No competing environment source ----------------------------------------


def test_app_settings_no_longer_expose_scheduling_policy():
    """Scheduling policy must not be readable from environment settings."""
    from app.core import Settings

    assert "maximum_interval_days" not in Settings.model_fields
    assert "enable_fuzz" not in Settings.model_fields


def test_environment_variables_cannot_override_policy(monkeypatch):
    monkeypatch.setenv("MAXIMUM_INTERVAL_DAYS", "365")
    monkeypatch.setenv("ENABLE_FUZZ", "false")

    policy = load_scheduling_config().scheduling

    assert policy.maximum_interval_days == 90
    assert policy.enable_fuzz is True
