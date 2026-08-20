"""
Core configuration and settings for the Glot backend.
"""

import json
from functools import lru_cache

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # App
    app_name: str = "Glot API"
    app_version: str = "0.3.4"  # x-release-please-version
    debug: bool = False

    # Database
    database_url: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/glot"
    database_url_sync: str = (
        "postgresql+psycopg2://postgres:postgres@localhost:5432/glot"
    )
    database_use_null_pool: bool = False

    # Scheduling, auth token lifetimes, resource limits, extraction model,
    # database pool tuning, and rate limits are NOT here: they live in
    # config/app.yaml (see app.core.app_config) so there is one canonical
    # source of truth with no environment overrides.

    # Authentication
    jwt_secret: str

    # CORS
    cors_origins: list[str] = ["http://localhost:3000"]

    # Cloudflare R2
    r2_account_id: str
    r2_access_key_id: str
    r2_secret_access_key: str
    r2_bucket_name: str

    # Redis
    redis_url: str = "redis://localhost:6379"

    # Extraction Agent
    openrouter_api_key: str

    @field_validator("jwt_secret")
    @classmethod
    def validate_jwt_secret(cls, value: str) -> str:
        """Require a non-empty JWT secret."""
        if not value.strip():
            raise ValueError("JWT_SECRET must not be blank")
        return value

    @field_validator("cors_origins", mode="before")
    @classmethod
    def parse_json_list(cls, value):
        if isinstance(value, str):
            try:
                parsed = json.loads(value)
                if isinstance(parsed, list):
                    return parsed
            except json.JSONDecodeError:
                # Fallback: treat comma-separated string as list
                return [item.strip() for item in value.split(",") if item.strip()]
        return value


@lru_cache
def get_settings() -> Settings:
    """Get cached settings instance."""
    return Settings()
