"""Focused tests for the activity service (streaks, dense dates, timezone validation)."""

from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest

from app.core.timezones import is_valid_timezone
from app.schemas.activity import ActivityResponse
from app.schemas.settings import SettingsUpdate
from app.services.activity import (
    GRID_DAYS,
    _grid_dates,
    _next_local_midnight,
    _streaks_from_dates,
)


def test_streak_rules_match_issue_126() -> None:
    # Active Mon-Wed; on Thursday the current streak is 3.
    current, longest = _streaks_from_dates(
        {"2026-06-01", "2026-06-02", "2026-06-03"}, "2026-06-04"
    )
    assert current == 3
    assert longest == 3

    # Friday with Thursday still empty: current streak resets; best remains 3.
    current, longest = _streaks_from_dates(
        {"2026-06-01", "2026-06-02", "2026-06-03"}, "2026-06-05"
    )
    assert current == 0
    assert longest == 3

    # A Friday review starts a streak of 1; previous best stays 3.
    current, longest = _streaks_from_dates(
        {"2026-06-01", "2026-06-02", "2026-06-03", "2026-06-05"}, "2026-06-05"
    )
    assert current == 1
    assert longest == 3

    # No activity: both zero.
    assert _streaks_from_dates(set(), "2026-06-05") == (0, 0)

    # A 400-day run produces a 400 streak despite a 365-day grid.
    start = datetime(2025, 5, 1).date()
    run = {(start + timedelta(days=offset)).isoformat() for offset in range(400)}
    current, longest = _streaks_from_dates(run, (start + timedelta(days=399)).isoformat())
    assert current == 400
    assert longest == 400


def test_grid_dates_are_dense_and_365() -> None:
    dates = _grid_dates("2026-01-01", GRID_DAYS)
    assert len(dates) == 365
    assert dates == sorted(set(dates))
    assert dates[0] == "2026-01-01"
    # Leap year coverage: 2024 includes Feb 29.
    leap = _grid_dates("2024-01-01", GRID_DAYS)
    assert "2024-02-29" in leap


def test_next_local_midnight_is_dst_aware() -> None:
    zone = ZoneInfo("America/Toronto")
    # 2026-03-08 is Toronto's spring-forward day (a 23-hour day).
    before = datetime(2026, 3, 8, 10, 0, tzinfo=UTC)
    nxt = _next_local_midnight(before, zone)
    assert nxt.astimezone(zone).date().isoformat() == "2026-03-09"
    assert nxt.tzinfo is not None
    # The gap to midnight is 23 hours on the spring-forward boundary.
    local_midnight = nxt.astimezone(zone)
    assert (local_midnight.date() - before.astimezone(zone).date()).days == 1


def test_timezone_validation_accepts_iana_names() -> None:
    assert is_valid_timezone("America/Toronto") is True
    assert is_valid_timezone("UTC") is True
    assert is_valid_timezone("Europe/Paris") is True


def test_timezone_validation_rejects_fixed_offsets_and_unknown() -> None:
    assert is_valid_timezone("+02:00") is False
    assert is_valid_timezone("Not/AZone") is False
    assert is_valid_timezone("") is False


def test_settings_update_rejects_explicit_null_timezone() -> None:
    with pytest.raises(ValueError, match="null"):
        SettingsUpdate.model_validate({"timezone": None})


def test_settings_update_rejects_invalid_timezones() -> None:
    for value in ["+02:00", "Not/AZone", "  "]:
        with pytest.raises(ValueError):
            SettingsUpdate.model_validate({"timezone": value})


def test_settings_update_accepts_valid_timezone() -> None:
    update = SettingsUpdate.model_validate({"timezone": "America/Toronto"})
    assert update.timezone == "America/Toronto"


def test_activity_response_requires_exactly_365_days() -> None:
    base = {
        "as_of": datetime(2026, 6, 1, tzinfo=UTC),
        "timezone": "UTC",
        "timezone_is_set": False,
        "today": "2026-06-01",
        "range_start": "2025-06-03",
        "range_end": "2026-06-01",
        "next_day_starts_at": datetime(2026, 6, 2, tzinfo=UTC),
        "today_review_count": 0,
        "current_streak": 0,
        "longest_streak": 0,
        "last_active_date": None,
        "days": [{"date": d, "review_count": 0} for d in _grid_dates("2025-06-03", 365)],
    }
    response = ActivityResponse.model_validate(base)
    assert len(response.days) == 365

    # 364 days must be rejected.
    short = dict(base)
    short["days"] = base["days"][:364]
    with pytest.raises(Exception):
        ActivityResponse.model_validate(short)
