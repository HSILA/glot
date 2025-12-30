"""
Date/time utilities for consistent timezone handling.

All datetimes in the application should be UTC-aware.
"""

from datetime import UTC, datetime

from sqlalchemy import DateTime


def utc_now() -> datetime:
    """Return current UTC time as timezone-aware datetime."""
    return datetime.now(UTC)


# SQLAlchemy type for timezone-aware timestamps
TimestampTZ = DateTime(timezone=True)
