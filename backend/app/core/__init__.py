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
    database_url_sync: str = "postgresql+psycopg2://postgres:postgres@localhost:5432/glot"

    # FSRS Settings (global defaults)
    default_desired_retention: float = 0.9
    default_maximum_interval_days: int = 365
    default_enable_fuzz: bool = True

    # CORS
    cors_origins: list[str] = ["http://localhost:3000"]


@lru_cache
def get_settings() -> Settings:
    """Get cached settings instance."""
    return Settings()
