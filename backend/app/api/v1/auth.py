"""
Authentication API endpoints.

Endpoints:
    POST /auth/register - Create new user account
    POST /auth/login - Get access token (refresh token in cookie)
    POST /auth/refresh - Rotate refresh token, get new access token
    POST /auth/logout - Revoke current device's session
    POST /auth/logout-all - Revoke all sessions
    GET /auth/me - Get current user profile
    POST /auth/change-password - Change password
    GET /auth/devices - List active sessions
    DELETE /auth/devices/{id} - Revoke specific session
"""

from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, Response, status
from loguru import logger
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.core import (
    RATE_LIMIT_LOGIN,
    RATE_LIMIT_REFRESH,
    RATE_LIMIT_REGISTER,
    get_settings,
)
from app.core.security import (
    create_access_token,
    generate_refresh_token,
    hash_password,
    hash_refresh_token,
    parse_device_name,
    verify_password,
)
from app.dependencies import get_async_session, get_current_user
from app.models import RefreshToken, User, UserSettings
from app.schemas import (
    DeviceListResponse,
    DeviceRead,
    LoginRequest,
    MessageResponse,
    PasswordChangeRequest,
    PasswordChangeResponse,
    TokenResponse,
    UserRead,
    UserRegister,
    UserRegistered,
)

router = APIRouter()
limiter = Limiter(key_func=get_remote_address)


def _set_auth_cookies(
    response: Response,
    access_token: str,
    refresh_token: str,
    settings: object,
) -> None:
    """Set HttpOnly cookies for access and refresh tokens."""
    # Access token cookie
    response.set_cookie(
        key="access_token",
        value=access_token,
        httponly=True,
        secure=True,  # HTTPS only (set to False for local dev if needed)
        samesite="lax",
        max_age=settings.access_token_expire_minutes * 60,
    )

    # Refresh token cookie (more restrictive)
    response.set_cookie(
        key="refresh_token",
        value=refresh_token,
        httponly=True,
        secure=True,
        samesite="strict",
        max_age=settings.refresh_token_expire_days * 24 * 60 * 60,
        path="/api/v1/auth",  # Only sent to auth endpoints
    )


def _clear_auth_cookies(response: Response) -> None:
    """Clear authentication cookies."""
    response.delete_cookie(key="access_token")
    response.delete_cookie(key="refresh_token", path="/api/v1/auth")


@router.post(
    "/register", response_model=UserRegistered, status_code=status.HTTP_201_CREATED
)
@limiter.limit(RATE_LIMIT_REGISTER)
async def register(
    request: Request,
    user_data: UserRegister,
    session: Annotated[AsyncSession, Depends(get_async_session)],
):
    """
    Register a new user account.

    Creates the user and their default settings.
    Does NOT log them in - they must call /login after registration.
    """
    # Check if email already exists
    result = await session.execute(
        select(User).where(User.email == user_data.email.lower())
    )
    existing_user = result.scalar_one_or_none()
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already registered",
        )

    # Create user
    user = User(
        email=user_data.email.lower(),
        password_hash=hash_password(user_data.password),
        display_name=user_data.display_name,
    )
    session.add(user)
    await session.flush()  # Get the user ID

    # Create default settings for user
    user_settings = UserSettings(user_id=user.id)
    session.add(user_settings)

    await session.flush()
    await session.refresh(user)

    logger.info(f"New user registered: {user.email} (id={user.id})")

    return UserRegistered(
        id=user.id,
        email=user.email,
        display_name=user.display_name,
    )


@router.post("/login", response_model=TokenResponse)
@limiter.limit(RATE_LIMIT_LOGIN)
async def login(
    request: Request,
    response: Response,
    login_data: LoginRequest,
    session: Annotated[AsyncSession, Depends(get_async_session)],
):
    """
    Authenticate and get access token.

    Sets HttpOnly cookies for both access and refresh tokens.
    Returns access token info in response body.
    """
    settings = get_settings()

    # Find user by email
    result = await session.execute(
        select(User).where(User.email == login_data.email.lower())
    )
    user = result.scalar_one_or_none()

    if not user or not verify_password(login_data.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your account is awaiting admin approval.",
        )

    # Update last login
    user.last_login_at = datetime.now(UTC)

    # Generate tokens
    access_token = create_access_token(user.id)
    refresh_token = generate_refresh_token()

    # Store refresh token in database
    device_name = parse_device_name(request.headers.get("User-Agent"))
    refresh_token_record = RefreshToken(
        user_id=user.id,
        token_hash=hash_refresh_token(refresh_token),
        device_name=device_name,
        expires_at=datetime.now(UTC)
        + timedelta(days=settings.refresh_token_expire_days),
    )
    session.add(refresh_token_record)

    # Set cookies
    _set_auth_cookies(response, access_token, refresh_token, settings)

    logger.info(f"User logged in: {user.email} from {device_name}")

    return TokenResponse(
        access_token=access_token,
        expires_in=settings.access_token_expire_minutes * 60,
    )


@router.post("/refresh", response_model=TokenResponse)
@limiter.limit(RATE_LIMIT_REFRESH)
async def refresh_tokens(
    request: Request,
    response: Response,
    refresh_token: Annotated[str | None, Cookie()] = None,
    session: AsyncSession = Depends(get_async_session),
):
    """
    Rotate refresh token and get new access token.

    This implements rolling sessions:
    - Old refresh token is deleted
    - New refresh token is created with fresh expiry
    - New access token is generated

    As long as user keeps refreshing within 14 days, session never expires.
    """
    settings = get_settings()

    if not refresh_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="No refresh token",
        )

    # Find the token in database
    token_hash = hash_refresh_token(refresh_token)
    result = await session.execute(
        select(RefreshToken).where(RefreshToken.token_hash == token_hash)
    )
    token_record = result.scalar_one_or_none()

    if not token_record:
        # Token not found - might have been revoked or is invalid
        _clear_auth_cookies(response)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid refresh token",
        )

    # Check expiry
    if token_record.expires_at < datetime.now(UTC):
        # Token expired - delete it and force re-login
        await session.delete(token_record)
        _clear_auth_cookies(response)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Refresh token expired",
        )

    # Get the user
    user = await session.get(User, token_record.user_id)
    if not user or not user.is_active:
        await session.delete(token_record)
        _clear_auth_cookies(response)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found or disabled",
        )

    # Rotate token: delete old, create new
    device_name = token_record.device_name  # Preserve device name
    await session.delete(token_record)

    # Generate new tokens
    new_access_token = create_access_token(user.id)
    new_refresh_token = generate_refresh_token()

    # Store new refresh token
    new_token_record = RefreshToken(
        user_id=user.id,
        token_hash=hash_refresh_token(new_refresh_token),
        device_name=device_name,
        expires_at=datetime.now(UTC)
        + timedelta(days=settings.refresh_token_expire_days),
    )
    session.add(new_token_record)

    # Set new cookies
    _set_auth_cookies(response, new_access_token, new_refresh_token, settings)

    logger.debug(f"Token refreshed for user {user.id}")

    return TokenResponse(
        access_token=new_access_token,
        expires_in=settings.access_token_expire_minutes * 60,
    )


@router.post("/logout", response_model=MessageResponse)
async def logout(
    response: Response,
    refresh_token: Annotated[str | None, Cookie()] = None,
    session: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(get_current_user),
):
    """
    Log out from current device.

    Revokes the refresh token for this session and clears cookies.
    """
    if refresh_token:
        token_hash = hash_refresh_token(refresh_token)
        result = await session.execute(
            select(RefreshToken).where(RefreshToken.token_hash == token_hash)
        )
        token_record = result.scalar_one_or_none()
        if token_record:
            await session.delete(token_record)

    _clear_auth_cookies(response)

    logger.info(f"User logged out: {current_user.email}")

    return MessageResponse(message="Logged out successfully")


@router.post("/logout-all", response_model=MessageResponse)
async def logout_all_devices(
    response: Response,
    session: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(get_current_user),
):
    """
    Log out from all devices.

    Revokes all refresh tokens for this user.
    """
    result = await session.execute(
        select(RefreshToken).where(RefreshToken.user_id == current_user.id)
    )
    tokens = result.scalars().all()

    for token in tokens:
        await session.delete(token)

    _clear_auth_cookies(response)

    logger.info(
        f"User logged out from all devices: {current_user.email} ({len(tokens)} sessions)"
    )

    return MessageResponse(message=f"Logged out from {len(tokens)} device(s)")


@router.get("/me", response_model=UserRead)
async def get_me(
    current_user: User = Depends(get_current_user),
):
    """Get current user's profile."""
    return current_user


@router.post("/change-password", response_model=PasswordChangeResponse)
async def change_password(
    password_data: PasswordChangeRequest,
    session: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(get_current_user),
):
    """
    Change current user's password.

    Requires the current password for verification.
    """
    # Verify current password
    if not verify_password(password_data.current_password, current_user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Current password is incorrect",
        )

    # Update password
    current_user.password_hash = hash_password(password_data.new_password)

    logger.info(f"Password changed for user: {current_user.email}")

    return PasswordChangeResponse()


@router.get("/devices", response_model=DeviceListResponse)
async def list_devices(
    refresh_token: Annotated[str | None, Cookie()] = None,
    session: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(get_current_user),
):
    """
    List all active sessions/devices for current user.

    Marks the current device with is_current=True.
    """
    result = await session.execute(
        select(RefreshToken)
        .where(RefreshToken.user_id == current_user.id)
        .order_by(RefreshToken.last_used_at.desc())
    )
    tokens = result.scalars().all()

    # Identify current device
    current_token_hash = hash_refresh_token(refresh_token) if refresh_token else None

    devices = []
    for token in tokens:
        is_current = token.token_hash == current_token_hash
        devices.append(
            DeviceRead(
                id=token.id,
                device_name=token.device_name,
                created_at=token.created_at,
                last_used_at=token.last_used_at,
                is_current=is_current,
            )
        )

    return DeviceListResponse(devices=devices, total=len(devices))


@router.delete("/devices/{device_id}", response_model=MessageResponse)
async def revoke_device(
    device_id: int,
    session: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(get_current_user),
):
    """
    Revoke a specific device's session.

    Cannot revoke the current device - use /logout instead.
    """
    result = await session.execute(
        select(RefreshToken).where(
            RefreshToken.id == device_id,
            RefreshToken.user_id == current_user.id,
        )
    )
    token = result.scalar_one_or_none()

    if not token:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Device not found",
        )

    device_name = token.device_name or "Unknown device"
    await session.delete(token)

    logger.info(f"Device revoked for user {current_user.email}: {device_name}")

    return MessageResponse(message=f"Device '{device_name}' has been logged out")
