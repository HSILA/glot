"""Shared timezone helpers for the study calendar (issue #126).

Kept dependency-free (no model or schema imports) so models, schemas, and
services can all use it without import cycles.
"""

from zoneinfo import ZoneInfo, available_timezones

TIMEZONE_MAX_LENGTH = 64


def is_valid_timezone(name: str) -> bool:
    """Return whether the name is a real IANA timezone supported by Python."""
    try:
        ZoneInfo(name)
    except Exception:
        return False
    return name in available_timezones()
