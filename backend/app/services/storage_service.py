"""
Storage service for Cloudflare R2 operations.

Provides S3-compatible operations for:
- Presigned URL generation (upload/download)
- File upload/download
- File deletion
- Content hash computation
"""

import asyncio
import hashlib
from typing import BinaryIO

import boto3
from botocore.config import Config

from app.core import Settings


class StorageObjectTooLargeError(ValueError):
    """Raised before an object larger than the allowed bound is materialized."""


class StorageObjectNotFoundError(Exception):
    """Raised when a storage object that should exist (e.g. a staged upload)
    is missing. Callers surface this as a normal 4xx rather than a 500."""


class StorageService:
    """
    Cloudflare R2 storage operations.

    Uses boto3 with S3-compatible endpoint.
    """

    def __init__(self, settings: Settings) -> None:
        self._bucket_name = settings.r2_bucket_name
        self._client = boto3.client(
            "s3",
            endpoint_url=f"https://{settings.r2_account_id}.r2.cloudflarestorage.com",
            aws_access_key_id=settings.r2_access_key_id,
            aws_secret_access_key=settings.r2_secret_access_key,
            region_name="auto",
            config=Config(signature_version="s3v4"),
        )

    @property
    def bucket_name(self) -> str:
        return self._bucket_name

    def generate_upload_url(
        self,
        key_or_hash: str,
        content_type: str = "application/pdf",
        expires_in: int = 900,
        folder: str | None = "raw",
    ) -> str:
        """Generate a presigned direct-upload URL."""
        if folder is None:
            key = key_or_hash
        elif folder == "raw":
            key = f"raw/{key_or_hash}.pdf"
        else:
            key = f"{folder}/{key_or_hash}"

        return self._client.generate_presigned_url(
            "put_object",
            Params={
                "Bucket": self._bucket_name,
                "Key": key,
                "ContentType": content_type,
            },
            ExpiresIn=expires_in,
        )

    def generate_download_url(
        self,
        content_hash: str,
        folder: str = "raw",
        expires_in: int = 3600,  # 1 hour
        response_content_type: str | None = None,
    ) -> str:
        """
        Generate a presigned URL for downloading a file.

        Args:
            content_hash: SHA-256 hash of the file
            folder: Storage folder (raw, processed, thumbnails)
            expires_in: URL expiration in seconds
            response_content_type: Optional content type for response

        Returns:
            Presigned URL for GET request
        """
        if folder == "raw":
            key = f"raw/{content_hash}.pdf"
        elif folder == "thumbnails":
            key = f"thumbnails/{content_hash}.webp"
        else:
            key = f"{folder}/{content_hash}"

        params = {
            "Bucket": self._bucket_name,
            "Key": key,
        }
        if folder == "raw":
            params["ResponseContentDisposition"] = (
                f'attachment; filename="{content_hash}.pdf"'
            )
        if response_content_type:
            params["ResponseContentType"] = response_content_type

        return self._client.generate_presigned_url(
            "get_object",
            Params=params,
            ExpiresIn=expires_in,
        )

    def upload_file(
        self,
        file: bytes | BinaryIO,
        key_or_hash: str,
        folder: str | None = "raw",
        content_type: str = "application/pdf",
    ) -> None:
        """
        Upload a file to R2.

        Args:
            file: Bytes or file-like object to upload
            key_or_hash: Either a full key path (if folder is None) or content hash
            folder: Target folder (raw, processed, thumbnails) or None for custom key
            content_type: MIME type of the file
        """
        from io import BytesIO

        # Determine the key
        if folder is None:
            # key_or_hash is the full key path
            key = key_or_hash
        elif folder == "raw":
            key = f"raw/{key_or_hash}.pdf"
        elif folder == "thumbnails":
            key = f"thumbnails/{key_or_hash}.webp"
        else:
            key = f"{folder}/{key_or_hash}"

        # Convert bytes to file-like if needed
        if isinstance(file, bytes):
            file = BytesIO(file)

        self._client.upload_fileobj(
            file,
            self._bucket_name,
            key,
            ExtraArgs={"ContentType": content_type},
        )

    def download_file(self, key_or_hash: str, folder: str | None = "raw") -> bytes:
        """
        Download a file from R2.

        Args:
            key_or_hash: Either a full key path (if folder is None) or content hash
            folder: Source folder or None for custom key path

        Returns:
            File contents as bytes
        """
        if folder is None:
            key = key_or_hash
        elif folder == "raw":
            key = f"raw/{key_or_hash}.pdf"
        elif folder == "thumbnails":
            key = f"thumbnails/{key_or_hash}.webp"
        else:
            key = f"{folder}/{key_or_hash}"

        response = self._client.get_object(Bucket=self._bucket_name, Key=key)
        return response["Body"].read()

    def download_file_bounded(
        self,
        key_or_hash: str,
        max_bytes: int,
        folder: str | None = "raw",
    ) -> bytes:
        """Download at most ``max_bytes`` and reject oversized objects early."""
        if max_bytes < 0:
            raise ValueError("max_bytes must be non-negative")

        if folder is None:
            key = key_or_hash
        elif folder == "raw":
            key = f"raw/{key_or_hash}.pdf"
        elif folder == "thumbnails":
            key = f"thumbnails/{key_or_hash}.webp"
        else:
            key = f"{folder}/{key_or_hash}"

        try:
            response = self._client.get_object(Bucket=self._bucket_name, Key=key)
        except self._client.exceptions.NoSuchKey as exc:
            # A missing key is a normal "nothing staged here yet" condition, not
            # an infrastructure failure. Let callers return a clean 4xx.
            raise StorageObjectNotFoundError(
                f"Storage object not found: {key}"
            ) from exc
        except self._client.exceptions.ClientError as exc:
            # R2 may surface a missing key as a generic ClientError rather than
            # the modeled NoSuchKey. Distinguish a genuinely absent object from
            # a bucket-level fault (which also comes back 404) by error code, so
            # a misconfigured bucket is never mistaken for an empty upload.
            error = (
                exc.response.get("Error", {})
                if hasattr(exc, "response") and exc.response
                else {}
            )
            if error.get("Code") == "NoSuchKey":
                raise StorageObjectNotFoundError(
                    f"Storage object not found: {key}"
                ) from exc
            raise

        body = response["Body"]
        try:
            content_length = response.get("ContentLength")
            if content_length is not None and int(content_length) > max_bytes:
                raise StorageObjectTooLargeError(
                    f"Object is {content_length} bytes; limit is {max_bytes}"
                )

            payload = body.read(max_bytes + 1)
            if len(payload) > max_bytes:
                raise StorageObjectTooLargeError(
                    f"Object exceeds the {max_bytes}-byte limit"
                )
            return payload
        finally:
            body.close()

    def delete_file(self, key_or_hash: str, folder: str | None = "raw") -> None:
        """
        Delete a file from R2.

        Args:
            key_or_hash: Either a full key path (if folder is None) or content hash
            folder: Source folder or None for custom key path
        """
        if folder is None:
            key = key_or_hash
        elif folder == "raw":
            key = f"raw/{key_or_hash}.pdf"
        elif folder == "thumbnails":
            key = f"thumbnails/{key_or_hash}.webp"
        else:
            key = f"{folder}/{key_or_hash}"

        self._client.delete_object(Bucket=self._bucket_name, Key=key)

    def delete_folder(self, prefix: str) -> None:
        """
        Delete all files under a prefix.

        Args:
            prefix: Folder prefix (e.g., "processed/abc123/" or "temp/abc123/")
        """
        if not prefix.endswith("/"):
            prefix = prefix + "/"

        paginator = self._client.get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=self._bucket_name, Prefix=prefix):
            if "Contents" in page:
                objects = [{"Key": obj["Key"]} for obj in page["Contents"]]
                if objects:
                    self._client.delete_objects(
                        Bucket=self._bucket_name,
                        Delete={"Objects": objects},
                    )

    def delete_processed_folder(self, content_hash: str) -> None:
        """
        Delete all processed files for a resource.

        Args:
            content_hash: SHA-256 hash of the resource
        """
        self.delete_folder(f"processed/{content_hash}/")

    def delete_temp_folder(self, content_hash: str) -> None:
        """
        Delete all temporary rendered page images for a resource.

        Args:
            content_hash: SHA-256 hash of the resource
        """
        self.delete_folder(f"temp/{content_hash}/")

    def file_exists(self, key_or_hash: str, folder: str | None = "raw") -> bool:
        """
        Check if a file exists in R2.

        Args:
            key_or_hash: Either a full key path (if folder is None) or content hash
            folder: Source folder or None for custom key path

        Returns:
            True if file exists
        """
        if folder is None:
            key = key_or_hash
        elif folder == "raw":
            key = f"raw/{key_or_hash}.pdf"
        elif folder == "thumbnails":
            key = f"thumbnails/{key_or_hash}.webp"
        else:
            key = f"{folder}/{key_or_hash}"

        try:
            self._client.head_object(Bucket=self._bucket_name, Key=key)
            return True
        except self._client.exceptions.ClientError:
            return False

    def folder_exists(self, prefix: str) -> bool:
        """
        Check if a folder (prefix) has any files in R2.

        Args:
            prefix: The folder prefix to check (e.g., "temp/abc123")

        Returns:
            True if folder has at least one file
        """
        # Ensure prefix ends with /
        if not prefix.endswith("/"):
            prefix = prefix + "/"

        response = self._client.list_objects_v2(
            Bucket=self._bucket_name,
            Prefix=prefix,
            MaxKeys=1,
        )
        return response.get("KeyCount", 0) > 0

    def list_object_keys(self, prefix: str, limit: int = 200) -> list[str]:
        """Return up to ``limit`` object keys under ``prefix`` (pagination-aware).

        Used to drive storage-side cleanup by enumerating what actually exists,
        so a sweeper makes progress regardless of DB row ordering.
        """
        if not prefix.endswith("/"):
            prefix = prefix + "/"
        keys: list[str] = []
        kwargs = {"Bucket": self._bucket_name, "Prefix": prefix}
        while len(keys) < limit:
            resp = self._client.list_objects_v2(MaxKeys=limit, **kwargs)
            keys.extend(
                obj["Key"]
                for obj in resp.get("Contents", [])
                if obj.get("Key")
            )
            if not resp.get("IsTruncated"):
                break
            kwargs["ContinuationToken"] = resp.get("NextContinuationToken")
        return keys[:limit]

    # Async wrappers for network-bound boto3 operations.
    # These keep async API/worker paths from blocking the event loop.
    async def async_upload_file(
        self,
        file: bytes | BinaryIO,
        key_or_hash: str,
        folder: str | None = "raw",
        content_type: str = "application/pdf",
    ) -> None:
        await asyncio.to_thread(
            self.upload_file,
            file,
            key_or_hash,
            folder,
            content_type,
        )

    async def async_download_file(
        self,
        key_or_hash: str,
        folder: str | None = "raw",
    ) -> bytes:
        return await asyncio.to_thread(self.download_file, key_or_hash, folder)

    async def async_download_file_bounded(
        self,
        key_or_hash: str,
        max_bytes: int,
        folder: str | None = "raw",
    ) -> bytes:
        return await asyncio.to_thread(
            self.download_file_bounded,
            key_or_hash,
            max_bytes,
            folder,
        )

    async def async_delete_file(
        self,
        key_or_hash: str,
        folder: str | None = "raw",
    ) -> None:
        await asyncio.to_thread(self.delete_file, key_or_hash, folder)

    async def async_delete_folder(self, prefix: str) -> None:
        await asyncio.to_thread(self.delete_folder, prefix)

    async def async_delete_processed_folder(self, content_hash: str) -> None:
        await asyncio.to_thread(self.delete_processed_folder, content_hash)

    async def async_delete_temp_folder(self, content_hash: str) -> None:
        await asyncio.to_thread(self.delete_temp_folder, content_hash)

    async def async_file_exists(
        self,
        key_or_hash: str,
        folder: str | None = "raw",
    ) -> bool:
        return await asyncio.to_thread(self.file_exists, key_or_hash, folder)

    async def async_folder_exists(self, prefix: str) -> bool:
        return await asyncio.to_thread(self.folder_exists, prefix)

    async def async_list_object_keys(self, prefix: str, limit: int = 200) -> list[str]:
        return await asyncio.to_thread(self.list_object_keys, prefix, limit)

    async def async_upload_thumbnail(self, image_bytes: bytes, content_hash: str) -> None:
        await asyncio.to_thread(self.upload_thumbnail, image_bytes, content_hash)

    async def async_upload_processed_page(
        self,
        markdown_content: str,
        content_hash: str,
        page_number: int,
    ) -> None:
        await asyncio.to_thread(
            self.upload_processed_page,
            markdown_content,
            content_hash,
            page_number,
        )

    @staticmethod
    def compute_hash(file: BinaryIO, chunk_size: int = 8192) -> str:
        """
        Compute SHA-256 hash of file content.

        Args:
            file: File-like object
            chunk_size: Read chunk size in bytes

        Returns:
            Hex-encoded SHA-256 hash
        """
        sha256 = hashlib.sha256()
        file.seek(0)
        while chunk := file.read(chunk_size):
            sha256.update(chunk)
        file.seek(0)  # Reset for potential re-read
        return sha256.hexdigest()

    def upload_thumbnail(self, image_bytes: bytes, content_hash: str) -> None:
        """
        Upload a thumbnail image to R2.

        Args:
            image_bytes: WebP image bytes
            content_hash: SHA-256 hash of the original PDF
        """
        from io import BytesIO

        self.upload_file(
            BytesIO(image_bytes),
            content_hash,
            folder="thumbnails",
            content_type="image/webp",
        )

    def upload_processed_page(
        self,
        markdown_content: str,
        content_hash: str,
        page_number: int,
    ) -> None:
        """
        Upload a processed page (markdown) to R2.

        Args:
            markdown_content: Extracted text as markdown
            content_hash: SHA-256 hash of the original PDF
            page_number: Page number (1-indexed)
        """
        from io import BytesIO

        key = f"processed/{content_hash}/page_{page_number:04d}.md"
        self._client.upload_fileobj(
            BytesIO(markdown_content.encode("utf-8")),
            self._bucket_name,
            key,
            ExtraArgs={"ContentType": "text/markdown"},
        )
