"""
Core configuration and settings for the Glot backend.
"""

from functools import lru_cache

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
    app_version: str = "0.1.0"
    debug: bool = False

    # Database
    database_url: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/glot"
    database_url_sync: str = (
        "postgresql+psycopg2://postgres:postgres@localhost:5432/glot"
    )

    # Scheduling (global defaults)
    maximum_interval_days: int = 365
    enable_fuzz: bool = True

    # Authentication
    jwt_secret: str = "CHANGE-ME-IN-PRODUCTION-USE-STRONG-SECRET"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 30
    refresh_token_expire_days: int = 14

    # CORS
    cors_origins: list[str] = ["http://localhost:3000"]


# Rate limiting
RATE_LIMIT_LOGIN = "5/5minutes"
RATE_LIMIT_REGISTER = "3/hour"
RATE_LIMIT_REFRESH = "10/minute"


@lru_cache
def get_settings() -> Settings:
    """Get cached settings instance."""
    return Settings()
