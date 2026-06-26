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
    app_version: str = "0.3.3"  # x-release-please-version
    debug: bool = False

    # Database
    database_url: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/glot"
    database_url_sync: str = (
        "postgresql+psycopg2://postgres:postgres@localhost:5432/glot"
    )
    database_pool_pre_ping: bool = True
    database_pool_recycle: int = 1800
    database_pool_size: int = 10
    database_max_overflow: int = 20
    database_pool_timeout: float = 30.0
    database_use_null_pool: bool = False

    # Scheduling (global defaults)
    maximum_interval_days: int = 365
    enable_fuzz: bool = True

    # Authentication
    jwt_secret: str
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 30
    refresh_token_expire_days: int = 14

    # CORS
    cors_origins: list[str] = ["http://localhost:3000"]

    # Resources constraints
    resource_max_size_bytes: int = 75 * 1024 * 1024  # 75 MB
    resource_max_files_per_user: int = 10
    resource_allowed_types: list[str] = ["application/pdf"]

    # Cloudflare R2
    r2_account_id: str
    r2_access_key_id: str
    r2_secret_access_key: str
    r2_bucket_name: str

    # Redis
    redis_url: str = "redis://localhost:6379"

    # Extraction Agent
    openrouter_api_key: str
    extraction_agent_model: str = "qwen/qwen-3-vl-235b-a22b-instruct"
    extraction_worker_poll_delay_seconds: float = 15.0

    @field_validator("jwt_secret")
    @classmethod
    def validate_jwt_secret(cls, value: str) -> str:
        """Require a non-empty JWT secret."""
        if not value.strip():
            raise ValueError("JWT_SECRET must not be blank")
        return value

    @field_validator("cors_origins", "resource_allowed_types", mode="before")
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


# Rate limiting
RATE_LIMIT_LOGIN = "5/5minutes"
RATE_LIMIT_REGISTER = "3/hour"
RATE_LIMIT_REFRESH = "10/minute"


@lru_cache
def get_settings() -> Settings:
    """Get cached settings instance."""
    return Settings()
