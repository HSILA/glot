"""
UserResource model - Junction table linking users to resources.

Allows multiple users to reference the same underlying resource,
each with their own custom name.
"""

from datetime import datetime

from sqlalchemy import Column, text
from sqlmodel import Field, SQLModel

from app.core.datetime_utils import TimestampTZ, utc_now


class UserResource(SQLModel, table=True):
    """
    Junction table linking users to resources.

    Fields:
        - user_id: Reference to the user
        - resource_id: Reference to the global resource
        - name: User's custom name for this resource
        - added_at: When the user added this resource to their library
    """

    __tablename__ = "user_resources"

    user_id: int = Field(
        foreign_key="users.id",
        primary_key=True,
        description="Reference to the user",
    )
    resource_id: int = Field(
        foreign_key="resources.id",
        primary_key=True,
        index=True,
        description="Reference to the global resource",
    )

    # User's custom name
    name: str = Field(
        max_length=255,
        description="User's name for this resource",
    )

    # Timestamps
    added_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(TimestampTZ, server_default=text("now()"), nullable=False),
        description="When the user added this resource to their library",
    )
