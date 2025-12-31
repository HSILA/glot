#!/usr/bin/env python3
"""
Test script for Redis & ARQ worker connection.

Tests:
1. Redis connection
2. Job enqueuing
3. Worker function registration

Usage:
    cd backend
    uv run python test_redis.py
"""

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from app.core import get_settings
from app.services import RedisService


async def main():
    print("🧪 Testing Redis & ARQ Worker...\n")

    settings = get_settings()
    print(f"✓ Redis URL: {settings.redis_url}")

    # Test Redis connection
    redis = RedisService(settings.redis_url)
    print("\n📡 Connecting to Redis...")

    try:
        await redis.connect()
        print("✓ Redis connected!")
    except Exception as e:
        print(f"❌ Redis connection failed: {e}")
        return 1

    # Check if pool is an ArqRedis
    pool = await redis._ensure_connected()
    print(f"✓ Pool type: {type(pool).__name__}")

    # Check queued jobs
    print("\n📋 Checking ARQ queue...")
    try:
        # ARQ stores jobs in a specific Redis key
        job_keys = await pool.keys("arq:job:*")
        print(f"✓ Found {len(job_keys)} pending jobs")

        # Check queue
        queued = await pool.lrange("arq:queue", 0, -1)
        print(f"✓ Queue length: {len(queued)}")
        for job in queued[:5]:
            print(f"  - {job}")

    except Exception as e:
        print(f"⚠ Error checking queue: {e}")

    # Test enqueueing a dummy job (won't actually run unless worker picks it up)
    print("\n🚀 Testing job enqueue...")
    try:
        # Just check what jobs are registered
        from app.workers.extraction_worker import WorkerSettings

        print(f"✓ Worker functions: {[f.__name__ for f in WorkerSettings.functions]}")
        print(f"✓ Worker redis settings: {WorkerSettings.redis_settings}")

        # Try to enqueue
        job_id = await redis.enqueue_job("extract_resource", 999999)  # Fake ID
        if job_id:
            print(f"✅ Job enqueued! ID: {job_id}")
            print("   (Note: This won't succeed as resource doesn't exist)")
        else:
            print("❌ Job enqueue returned None - job may be deferred or duplicate")

    except Exception as e:
        print(f"❌ Job enqueue failed: {e}")
        import traceback

        traceback.print_exc()

    # Check if worker is running by looking at heartbeat
    print("\n💓 Checking worker health...")
    try:
        health = await pool.get("arq:health-check")
        if health:
            print(f"✓ Worker heartbeat: {health}")
        else:
            print("⚠ No worker heartbeat found - worker may not be running!")
    except Exception as e:
        print(f"⚠ Error checking health: {e}")

    await redis.close()
    print("\n✓ Redis connection closed")

    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
