"""
Global scheduling policy, loaded from a canonical version-controlled YAML file.

`backend/config/scheduling.yaml` is the single source of truth for scheduling
values that apply to every user. It is validated strictly at startup:

- the file must exist and be a YAML mapping
- every policy field is required (no fallback defaults in Python)
- unknown fields and wrong types are rejected

There is deliberately no environment override and no default value for any
policy field. A silent fallback would write wrong `next_review_at` values into
the database, and unlike a failed startup that damage is not self-correcting.

Per-user settings (desired_retention, weights) are not part of this file; they
live in the `user_settings` table.
"""

from functools import lru_cache
from pathlib import Path

import yaml
from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StrictInt,
    ValidationError,
    field_validator,
)

# The config directory sits next to the `app` package, both locally
# (backend/config) and in the image (/app/config, see Dockerfile).
DEFAULT_SCHEDULING_CONFIG_PATH = (
    Path(__file__).resolve().parents[2] / "config" / "scheduling.yaml"
)

# Guards against a typo turning into an effectively unbounded interval.
MAX_ALLOWED_INTERVAL_DAYS = 36500


class SchedulingConfigError(RuntimeError):
    """Raised when the scheduling policy file is missing or invalid."""


class SchedulingPolicy(BaseModel):
    """Global scheduling values applied to every user."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    maximum_interval_days: int = Field(
        strict=True,
        ge=1,
        le=MAX_ALLOWED_INTERVAL_DAYS,
        description="Hard cap in days on the interval FSRS may assign to a card",
    )
    enable_fuzz: bool = Field(
        strict=True,
        description="Add randomness to intervals to prevent review clumping",
    )


class SchedulingConfig(BaseModel):
    """Top-level structure of `config/scheduling.yaml`."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    version: StrictInt = Field(
        description="Schema version; the loader rejects versions it cannot read",
    )
    scheduling: SchedulingPolicy

    @field_validator("version")
    @classmethod
    def validate_version(cls, value: int) -> int:
        if value != 1:
            raise ValueError(f"Unsupported scheduling config version: {value}")
        return value


def load_scheduling_config(path: Path | None = None) -> SchedulingConfig:
    """
    Load and validate the scheduling policy file.

    Args:
        path: Config file to read. Defaults to the committed repository file.

    Raises:
        SchedulingConfigError: If the file is missing, unreadable, not valid
            YAML, or does not satisfy the schema.
    """
    config_path = Path(path) if path is not None else DEFAULT_SCHEDULING_CONFIG_PATH

    try:
        raw = config_path.read_text(encoding="utf-8")
    except FileNotFoundError as exc:
        raise SchedulingConfigError(
            f"Scheduling policy file not found: {config_path}. "
            "This file is required and must be committed to the repository."
        ) from exc
    except OSError as exc:
        raise SchedulingConfigError(
            f"Scheduling policy file could not be read: {config_path}: {exc}"
        ) from exc

    try:
        data = yaml.safe_load(raw)
    except yaml.YAMLError as exc:
        raise SchedulingConfigError(
            f"Scheduling policy file is not valid YAML: {config_path}: {exc}"
        ) from exc

    if not isinstance(data, dict):
        raise SchedulingConfigError(
            f"Scheduling policy file must contain a YAML mapping at the top "
            f"level: {config_path} (got {type(data).__name__})"
        )

    try:
        return SchedulingConfig.model_validate(data)
    except ValidationError as exc:
        raise SchedulingConfigError(
            f"Invalid scheduling policy file: {config_path}\n{exc}"
        ) from exc


@lru_cache
def get_scheduling_policy() -> SchedulingPolicy:
    """Get the cached global scheduling policy from the committed config file."""
    return load_scheduling_config().scheduling
