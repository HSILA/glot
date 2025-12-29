"""
User model - Core authentication and identity.

Stores user credentials and profile information.
Passwords are stored as hashes (never plain text).
"""
from datetime import datetime

from sqlalchemy import Index, text
from sqlmodel import Field, SQLModel


class User(SQLModel, table=True):
    """
    User model for authentication and identity.

    Fields:
        - email: Unique identifier for login (lowercase, indexed)
        - password_hash: Argon2/bcrypt hash of password
        - display_name: Optional nickname shown in UI
        - is_active: Soft delete / account suspension flag
        - joined_at: Registration timestamp
        - last_login_at: Last successful login timestamp
    """

    __tablename__ = "users"
    __table_args__ = (
        Index("ix_users_email_active", "email", "is_active"),
    )

    id: int | None = Field(default=None, primary_key=True)

    # Authentication
    email: str = Field(
        max_length=255,
        index=True,
        unique=True,
        description="User's email address (used for login)",
    )
    password_hash: str = Field(
        max_length=255,
        description="Hashed password (Argon2 or bcrypt)",
    )

    # Profile
    display_name: str | None = Field(
        default=None,
        max_length=100,
        description="Optional display name / nickname",
    )

    # Account status
    is_active: bool = Field(
        default=True,
        index=True,
        description="False = account suspended or soft-deleted",
    )

    # Timestamps
    joined_at: datetime = Field(
        default_factory=datetime.utcnow,
        sa_column_kwargs={"server_default": text("now()")},
        description="When the user registered",
    )
    last_login_at: datetime | None = Field(
        default=None,
        description="Last successful login timestamp",
    )
