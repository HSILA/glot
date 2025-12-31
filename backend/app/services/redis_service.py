"""
Redis service for caching and job queue operations.

Provides a unified interface for Redis operations including:
- ARQ job queue management
- Extraction progress tracking
- General caching
"""

from typing import Any

from arq import create_pool
from arq.connections import ArqRedis, RedisSettings
from loguru import logger


class RedisService:
    """
    Redis service for ARQ background jobs and caching.

    Usage:
        service = RedisService(settings)
        await service.connect()

        # Queue a job
        job_id = await service.enqueue_job("task_name", arg1, arg2)

        # Track progress
        await service.set_progress(resource_id, progress=50, current_page=5)
        progress = await service.get_progress(resource_id)

        await service.close()
    """

    def __init__(self, redis_url: str) -> None:
        """
        Initialize Redis service.

        Args:
            redis_url: Redis connection URL (e.g., redis://localhost:6379)
        """
        self._redis_url = redis_url
        self._redis_settings = self._parse_url(redis_url)
        self._pool: ArqRedis | None = None

    @staticmethod
    def _parse_url(url: str) -> RedisSettings:
        """Parse redis:// URL into RedisSettings."""
        # Remove redis:// prefix
        if url.startswith("redis://"):
            url = url[8:]

        # Handle redis://host:port/db format
        if ":" in url:
            host, rest = url.split(":", 1)
            port_str = rest.split("/")[0]
            port = int(port_str)
        else:
            host = url.split("/")[0]
            port = 6379

        # Extract database number if present
        db = 0
        if "/" in url:
            db_str = url.split("/")[-1]
            if db_str.isdigit():
                db = int(db_str)

        return RedisSettings(host=host, port=port, database=db)

    @property
    def redis_settings(self) -> RedisSettings:
        """Get ARQ-compatible Redis settings."""
        return self._redis_settings

    async def connect(self) -> None:
        """Establish connection to Redis."""
        if self._pool is None:
            self._pool = await create_pool(self._redis_settings)
            logger.debug("Redis connection established")

    async def close(self) -> None:
        """Close Redis connection."""
        if self._pool is not None:
            await self._pool.close()
            self._pool = None
            logger.debug("Redis connection closed")

    async def _ensure_connected(self) -> ArqRedis:
        """Ensure connection exists and return pool."""
        if self._pool is None:
            await self.connect()
        return self._pool  # type: ignore

    # === Job Queue Operations ===

    async def enqueue_job(
        self,
        function_name: str,
        *args: Any,
        **kwargs: Any,
    ) -> str | None:
        """
        Enqueue a background job.

        Args:
            function_name: Name of the function to execute
            *args: Positional arguments for the function
            **kwargs: Keyword arguments for the function

        Returns:
            Job ID if enqueued successfully, None otherwise
        """
        pool = await self._ensure_connected()
        job = await pool.enqueue_job(function_name, *args, **kwargs)
        return job.job_id if job else None

    # === Progress Tracking ===

    async def set_progress(
        self,
        resource_id: int,
        *,
        status: str | None = None,
        progress: int | None = None,
        current_page: int | None = None,
        total_pages: int | None = None,
        error: str | None = None,
        expire_seconds: int = 3600,
    ) -> None:
        """
        Set extraction progress for a resource.

        Args:
            resource_id: Resource being processed
            status: Extraction status (processing, completed, failed)
            progress: Progress percentage (0-100)
            current_page: Current page being processed
            total_pages: Total pages in document
            error: Error message if failed
            expire_seconds: TTL for the progress data
        """
        pool = await self._ensure_connected()
        key = f"extraction:{resource_id}"

        mapping: dict[str, Any] = {}
        if status is not None:
            mapping["status"] = status
        if progress is not None:
            mapping["progress"] = progress
        if current_page is not None:
            mapping["current_page"] = current_page
        if total_pages is not None:
            mapping["total_pages"] = total_pages
        if error is not None:
            mapping["error"] = error

        if mapping:
            await pool.hset(key, mapping=mapping)
            await pool.expire(key, expire_seconds)

    async def get_progress(self, resource_id: int) -> dict[str, Any] | None:
        """
        Get extraction progress for a resource.

        Args:
            resource_id: Resource ID

        Returns:
            Progress data dict or None if not found
        """
        pool = await self._ensure_connected()
        key = f"extraction:{resource_id}"

        data = await pool.hgetall(key)
        if not data:
            return None

        # Convert bytes keys/values to strings/ints
        return {
            "status": data.get(b"status", b"").decode(),
            "progress": int(data.get(b"progress", 0)),
            "current_page": int(data.get(b"current_page", 0)) or None,
            "total_pages": int(data.get(b"total_pages", 0)) or None,
            "error": data.get(b"error", b"").decode() or None,
        }

    async def clear_progress(self, resource_id: int) -> None:
        """Clear extraction progress data."""
        pool = await self._ensure_connected()
        await pool.delete(f"extraction:{resource_id}")
