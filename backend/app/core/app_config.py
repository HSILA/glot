"""
Canonical app-wide configuration, loaded from a version-controlled YAML file.

`backend/config/app.yaml` is the single source of truth for values that apply
globally rather than per-request or per-secret. It is validated strictly at
startup:

- the file must exist and be a YAML mapping
- every field in every section is required (no fallback defaults in Python)
- unknown fields, unknown sections, and wrong types are rejected

There is deliberately no environment override and no default value for any
field here. A silent fallback (e.g. a wrong scheduling cap) would persist
incorrect values into the database, and unlike a failed startup that damage
is not self-correcting.

Secrets, deployment endpoints/origins/modes, `app_name`, and `app_version`
live in `app.core.Settings` instead. Per-user scheduling settings
(desired_retention, weights) live in the `user_settings` table.
"""

import re
import sys
from functools import lru_cache
from importlib import resources
from pathlib import Path

import yaml
from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StrictBool,
    StrictInt,
    StrictStr,
    ValidationError,
    field_validator,
)

# The config directory sits next to the `app` package, both locally
# (backend/config) and in the image (/app/config, see Dockerfile).
DEFAULT_APP_CONFIG_PATH = Path(__file__).resolve().parents[2] / "config" / "app.yaml"
PACKAGED_APP_CONFIG = "config/app.yaml"

# Guards against a typo turning into an effectively unbounded interval.
MAX_ALLOWED_INTERVAL_DAYS = 36500

# Count and period multiplier must both be positive with no leading zero.
_RATE_LIMIT_PATTERN = re.compile(r"^[1-9]\d*/([1-9]\d*)?(second|minute|hour|day)s?$")

# Only algorithm actually wired up for token signing/verification.
_SUPPORTED_JWT_ALGORITHMS = {"HS256"}
_SUPPORTED_RESOURCE_TYPES = {"application/pdf"}


class AppConfigError(RuntimeError):
    """Raised when the app config file is missing or invalid."""


class SchedulingSection(BaseModel):
    """Global scheduling values applied to every user."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    maximum_interval_days: StrictInt = Field(
        ge=1,
        le=MAX_ALLOWED_INTERVAL_DAYS,
        description="Hard cap in days on the interval FSRS may assign to a card",
    )
    enable_fuzz: StrictBool = Field(
        description="Add randomness to intervals to prevent review clumping",
    )


class AuthSection(BaseModel):
    """JWT and session token policy."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    jwt_algorithm: StrictStr = Field(min_length=1)
    access_token_expire_minutes: StrictInt = Field(ge=1)
    refresh_token_expire_days: StrictInt = Field(ge=1)

    @field_validator("jwt_algorithm")
    @classmethod
    def validate_jwt_algorithm(cls, value: str) -> str:
        if value not in _SUPPORTED_JWT_ALGORITHMS:
            raise ValueError(
                f"Unsupported jwt_algorithm: {value!r} "
                f"(supported: {sorted(_SUPPORTED_JWT_ALGORITHMS)})"
            )
        return value


class ResourcesSection(BaseModel):
    """Upload constraints applied to every user."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    max_size_bytes: StrictInt = Field(ge=1)
    max_files_per_user: StrictInt = Field(ge=1)
    abandoned_upload_grace_seconds: StrictInt = Field(ge=0)
    allowed_types: list[StrictStr] = Field(min_length=1)

    @field_validator("allowed_types")
    @classmethod
    def validate_allowed_types(cls, value: list[str]) -> list[str]:
        if len(value) != len(set(value)) or set(value) != _SUPPORTED_RESOURCE_TYPES:
            raise ValueError(
                "allowed_types must list each supported runtime type exactly once: "
                f"{sorted(_SUPPORTED_RESOURCE_TYPES)}"
            )
        return value


class ExtractionSection(BaseModel):
    """Extraction agent model and worker polling cadence."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    agent_model: StrictStr = Field(min_length=1)
    worker_poll_delay_seconds: StrictInt = Field(ge=0)


class DatabasePoolSection(BaseModel):
    """SQLAlchemy connection pool tuning."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    pre_ping: StrictBool
    recycle_seconds: StrictInt = Field(ge=1)
    size: StrictInt = Field(ge=1)
    max_overflow: StrictInt = Field(ge=0)
    timeout_seconds: StrictInt = Field(ge=1)


class RateLimitsSection(BaseModel):
    """Per-endpoint rate limit strings, in slowapi's `<count>/<period>` format."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    login: StrictStr
    # Field name avoids "register", which shadows the `register` classmethod
    # ABCMeta contributes to every pydantic BaseModel; the YAML key stays "register".
    register_limit: StrictStr = Field(validation_alias="register")
    refresh: StrictStr

    @field_validator("login", "register_limit", "refresh")
    @classmethod
    def validate_rate_limit_format(cls, value: str) -> str:
        if not _RATE_LIMIT_PATTERN.match(value):
            raise ValueError(
                f"Invalid rate limit format: {value!r} "
                "(expected '<count>/<count><period>', e.g. '5/5minutes' or '3/hour')"
            )
        return value


class AppConfig(BaseModel):
    """Top-level structure of `config/app.yaml`."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    version: StrictInt = Field(
        description="Schema version; the loader rejects versions it cannot read",
    )
    scheduling: SchedulingSection
    auth: AuthSection
    resources: ResourcesSection
    extraction: ExtractionSection
    database_pool: DatabasePoolSection
    rate_limits: RateLimitsSection

    @field_validator("version")
    @classmethod
    def validate_version(cls, value: int) -> int:
        if value != 1:
            raise ValueError(f"Unsupported app config version: {value}")
        return value


def _read_config(path: Path | None) -> tuple[str, str]:
    if path is not None:
        config_path = Path(path)
        try:
            return config_path.read_text(encoding="utf-8"), str(config_path)
        except FileNotFoundError as exc:
            raise AppConfigError(
                f"App config file not found: {config_path}. "
                "This file is required and must be committed to the repository."
            ) from exc
        except OSError as exc:
            raise AppConfigError(
                f"App config file could not be read: {config_path}: {exc}"
            ) from exc

    try:
        packaged = resources.files("app").joinpath(PACKAGED_APP_CONFIG)
        return packaged.read_text(encoding="utf-8"), f"package:{PACKAGED_APP_CONFIG}"
    except (FileNotFoundError, ModuleNotFoundError, OSError):
        pass

    try:
        return (
            DEFAULT_APP_CONFIG_PATH.read_text(encoding="utf-8"),
            str(DEFAULT_APP_CONFIG_PATH),
        )
    except FileNotFoundError as exc:
        raise AppConfigError(
            "App config file not found in the source tree or installed package."
        ) from exc
    except OSError as exc:
        raise AppConfigError(
            f"App config file could not be read: {DEFAULT_APP_CONFIG_PATH}: {exc}"
        ) from exc


def load_app_config(path: Path | None = None) -> AppConfig:
    """
    Load and validate the app config file.

    Args:
        path: Config file to read. Defaults to the committed repository file.

    Raises:
        AppConfigError: If the file is missing, unreadable, not valid YAML,
            or does not satisfy the schema.
    """
    raw, config_source = _read_config(path)

    try:
        data = yaml.safe_load(raw)
    except yaml.YAMLError as exc:
        raise AppConfigError(
            f"App config file is not valid YAML: {config_source}: {exc}"
        ) from exc

    if not isinstance(data, dict):
        raise AppConfigError(
            f"App config file must contain a YAML mapping at the top level: "
            f"{config_source} (got {type(data).__name__})"
        )

    try:
        return AppConfig.model_validate(data)
    except ValidationError as exc:
        raise AppConfigError(f"Invalid app config file: {config_source}\n{exc}") from exc


@lru_cache
def get_app_config() -> AppConfig:
    """Get the cached app config from the committed config file."""
    return load_app_config()


def main(argv: list[str] | None = None) -> int:
    args = sys.argv[1:] if argv is None else argv
    if len(args) > 1:
        print("usage: python -m app.core.app_config [path]", file=sys.stderr)
        return 2

    try:
        load_app_config(Path(args[0]) if args else None)
    except AppConfigError as exc:
        print(exc, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
