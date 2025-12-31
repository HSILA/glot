"""
Storage dependencies for FastAPI endpoints.
"""

from fastapi import Depends, HTTPException, status

from app.core import Settings, get_settings
from app.services.storage_service import StorageService


def get_storage_service(
    settings: Settings = Depends(get_settings),
) -> StorageService:
    """
    Dependency that provides a configured StorageService.

    Raises HTTPException if R2 is not configured.

    Usage:
        @router.post("/upload")
        async def upload(storage: StorageService = Depends(get_storage_service)):
            ...
    """
    if not all(
        [
            settings.r2_account_id,
            settings.r2_access_key_id,
            settings.r2_secret_access_key,
            settings.r2_bucket_name,
        ]
    ):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Storage service not configured. Set R2 environment variables.",
        )

    return StorageService(settings)
