"""
Security utilities for authentication.

This module provides:
- Password hashing and verification (Argon2)
- JWT token creation and validation
- Refresh token generation and hashing (SHA256)
- User-Agent device name parsing
"""

import hashlib
import re
import secrets
from datetime import UTC, datetime, timedelta

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from user_agents import parse as parse_user_agent

from app.core import get_settings

# Password hashing with Argon2 (no length limits, modern algorithm)
ph = PasswordHasher()

# Password validation constants
PASSWORD_MIN_LENGTH = 8
PASSWORD_MAX_LENGTH = 128  # Argon2 has no practical limit
PASSWORD_SPECIAL_CHARS = r"[!@#$%^&*()_+\-=\[\]{};':\",./<>?\\|`~]"


def hash_password(password: str) -> str:
    """Hash a password using Argon2."""
    return ph.hash(password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify a password against its Argon2 hash."""
    try:
        ph.verify(hashed_password, plain_password)
        return True
    except VerifyMismatchError:
        return False


def validate_password_strength(password: str) -> str:
    """
    Validate password meets security requirements.

    Requirements:
    - 8-128 characters
    - At least one letter
    - At least one number
    - At least one special character

    Returns the password if valid, raises ValueError if not.
    """
    if len(password) < PASSWORD_MIN_LENGTH:
        raise ValueError(f"Password must be at least {PASSWORD_MIN_LENGTH} characters")
    if len(password) > PASSWORD_MAX_LENGTH:
        raise ValueError(f"Password must be at most {PASSWORD_MAX_LENGTH} characters")
    if not re.search(r"[a-zA-Z]", password):
        raise ValueError("Password must contain at least one letter")
    if not re.search(r"\d", password):
        raise ValueError("Password must contain at least one number")
    if not re.search(PASSWORD_SPECIAL_CHARS, password):
        raise ValueError(
            "Password must contain at least one special character (!@#$%^&*...)"
        )
    return password


def create_access_token(user_id: int) -> str:
    """
    Create a JWT access token for a user.

    Payload contains only user_id (minimal, as agreed).
    Token expires after access_token_expire_minutes.
    """
    settings = get_settings()
    expire = datetime.now(UTC) + timedelta(minutes=settings.access_token_expire_minutes)

    payload = {
        "sub": str(user_id),  # Subject (user ID)
        "exp": expire,  # Expiration
        "iat": datetime.now(UTC),  # Issued at
        "type": "access",  # Token type
    }

    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_access_token(token: str) -> dict | None:
    """
    Decode and validate a JWT access token.

    Returns the payload if valid, None if invalid or expired.
    """
    settings = get_settings()
    try:
        payload = jwt.decode(
            token,
            settings.jwt_secret,
            algorithms=[settings.jwt_algorithm],
        )
        # Verify it's an access token
        if payload.get("type") != "access":
            return None
        return payload
    except jwt.ExpiredSignatureError:
        return None
    except jwt.InvalidTokenError:
        return None


def get_user_id_from_token(token: str) -> int | None:
    """Extract user_id from a valid access token."""
    payload = decode_access_token(token)
    if payload is None:
        return None
    try:
        return int(payload["sub"])
    except (KeyError, ValueError):
        return None


def generate_refresh_token() -> str:
    """
    Generate a cryptographically secure random refresh token.

    Returns a 64-character hex string (32 bytes of randomness).
    """
    return secrets.token_hex(32)


def hash_refresh_token(token: str) -> str:
    """
    Hash a refresh token using SHA256.

    We use SHA256 (not bcrypt) because:
    - Refresh tokens are already high-entropy random strings
    - We need fast comparison for token lookups
    - SHA256 is sufficient for random tokens
    """
    return hashlib.sha256(token.encode()).hexdigest()


def parse_device_name(user_agent: str | None) -> str:
    """
    Parse a User-Agent string to extract a human-readable device name.

    Examples:
    - "iPhone (iOS)"
    - "Pixel 7 (Android)"
    - "PC (Windows)"
    - "Mac (macOS)"
    - "Unknown Device"
    """
    if not user_agent:
        return "Unknown Device"

    try:
        ua = parse_user_agent(user_agent)

        device = ua.device.family or "Unknown"
        os_name = ua.os.family or ""

        # Clean up common device names
        if device == "Other":
            # Try to determine from OS
            if "Windows" in os_name:
                device = "PC"
            elif "Mac" in os_name:
                device = "Mac"
            elif "Linux" in os_name:
                device = "PC"
            else:
                device = "Unknown"

        # Format: "Device (OS)"
        if os_name:
            return f"{device} ({os_name})"
        return device

    except Exception:
        return "Unknown Device"
