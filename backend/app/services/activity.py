"""Activity service — study calendar, streaks, and daily aggregates.

Read model for issue #126: one SQL snapshot per request returns the user's
effective timezone and daily aggregates for all available history. The grid
is limited to 365 local dates; streaks are derived from positive-count
calendar dates over ALL history (a 400-day run still produces a 400 streak).
Missing grid dates are filled with zero in the service — never a query per
date.
"""

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

GRID_DAYS = 365


@dataclass(frozen=True, slots=True)
class ActivityDay:
    """One local calendar date and its committed review count."""

    date: str
    review_count: int


@dataclass(frozen=True, slots=True)
class ActivitySnapshot:
    """One consistent study-calendar snapshot for the activity endpoint."""

    as_of: datetime
    timezone: str
    timezone_is_set: bool
    today: str
    range_start: str
    range_end: str
    next_day_starts_at: datetime
    today_review_count: int
    current_streak: int
    longest_streak: int
    last_active_date: str | None
    days: list[ActivityDay]


def _local_date(value: datetime, zone: ZoneInfo) -> str:
    """Render one UTC instant as the YYYY-MM-DD local calendar date."""
    return value.astimezone(zone).date().isoformat()


def _streaks_from_dates(active_dates: set[str], today_local: str) -> tuple[int, int]:
    """Return (current_streak, longest_streak) from positive-count dates.

    - Current: consecutive active-date run ending today, or ending yesterday
      when today is empty (today stays available to continue it).
    - Longest: longest run over ALL provided history, not grid-capped.
    Calendar-date arithmetic only — no 24h subtraction.
    """
    if not active_dates:
        return 0, 0

    today = datetime.fromisoformat(today_local).date()
    current = 0
    day = today
    if day.isoformat() in active_dates:
        while day.isoformat() in active_dates:
            current += 1
            day -= timedelta(days=1)
    else:
        day -= timedelta(days=1)
        while day.isoformat() in active_dates:
            current += 1
            day -= timedelta(days=1)

    longest = 0
    run = 0
    previous_date = None
    for iso_date in sorted(active_dates):
        date = datetime.fromisoformat(iso_date).date()
        if previous_date is not None and date - previous_date == timedelta(days=1):
            run += 1
        else:
            run = 1
        longest = max(longest, run)
        previous_date = date

    return current, longest


def _validate_user_settings_timezone_name(name: str | None) -> str:
    """Return the effective IANA name; unset settings fall back to UTC."""
    from app.core.timezones import is_valid_timezone

    if name is not None and name.strip():
        if not is_valid_timezone(name):
            return "UTC"
        return name
    return "UTC"


async def build_activity_snapshot(
    session: AsyncSession,
    *,
    user_id: int,
    settings: Any,
) -> ActivitySnapshot:
    """Aggregate one user's full activity history in one consistent snapshot.

    Imports are local: this module is imported by ``app.models.settings`` for
    the timezone-name constant, so model imports must not run at module load.
    ``settings`` is the user's UserSettings row (duck-typed to avoid a cycle).
    """
    from app.models.study_activity import StudyActivityEvent

    effective_name = _validate_user_settings_timezone_name(settings.timezone)
    zone = ZoneInfo(effective_name)
    as_of = datetime.now(UTC)
    as_of_utc = as_of.astimezone(UTC)

    daily_rows = (
        await session.execute(
            select(
                func.count().label("review_count"),
                func.max(StudyActivityEvent.reviewed_at).label("last_active"),
            )
            .select_from(StudyActivityEvent)
            .where(
                StudyActivityEvent.user_id == user_id,
                StudyActivityEvent.reviewed_at <= as_of_utc,
            )
        )
    ).one()

    local_date_expr = func.to_char(
        func.timezone(effective_name, StudyActivityEvent.reviewed_at),
        "YYYY-MM-DD",
    ).label("local_date")
    grouped = (
        await session.execute(
            select(
                local_date_expr,
                func.count().label("review_count"),
            )
            .select_from(StudyActivityEvent)
            .where(
                StudyActivityEvent.user_id == user_id,
                StudyActivityEvent.reviewed_at <= as_of_utc,
            )
            .group_by(local_date_expr)
        )
    ).all()

    active_dates: set[str] = set()
    daily_counts: dict[str, int] = {}
    for date_key, review_count in grouped:
        # The DB's local-date expression (timestamptz AT TIME ZONE zone,
        # rendered YYYY-MM-DD) is the group key, so counts land on the
        # correct calendar date across DST boundaries.
        daily_counts[date_key] = int(review_count)
        active_dates.add(date_key)

    total_reviews = int(daily_rows[0] or 0)
    if total_reviews == 0:
        today_local = _local_date(as_of_utc, zone)
        range_start = (datetime.fromisoformat(today_local) - timedelta(days=GRID_DAYS - 1)).date().isoformat()
        return ActivitySnapshot(
            as_of=as_of,
            timezone=effective_name,
            timezone_is_set=bool(settings.timezone),
            today=today_local,
            range_start=range_start,
            range_end=today_local,
            next_day_starts_at=_next_local_midnight(as_of_utc, zone),
            today_review_count=0,
            current_streak=0,
            longest_streak=0,
            last_active_date=None,
            days=[ActivityDay(date=d, review_count=0) for d in _grid_dates(range_start, GRID_DAYS)],
        )

    today_local = _local_date(as_of_utc, zone)
    range_start_date = datetime.fromisoformat(today_local).date() - timedelta(days=GRID_DAYS - 1)
    range_start = range_start_date.isoformat()

    days = [
        ActivityDay(date=date_key, review_count=daily_counts.get(date_key, 0))
        for date_key in _grid_dates(range_start, GRID_DAYS)
    ]
    current_streak, longest_streak = _streaks_from_dates(active_dates, today_local)
    last_active_date = max(active_dates) if active_dates else None

    return ActivitySnapshot(
        as_of=as_of,
        timezone=effective_name,
        timezone_is_set=bool(settings.timezone),
        today=today_local,
        range_start=range_start,
        range_end=today_local,
        next_day_starts_at=_next_local_midnight(as_of_utc, zone),
        today_review_count=daily_counts.get(today_local, 0),
        current_streak=current_streak,
        longest_streak=longest_streak,
        last_active_date=last_active_date,
        days=days,
    )


def _grid_dates(range_start: str, count: int) -> list[str]:
    """Return count consecutive calendar dates from range_start (dense)."""
    start = datetime.fromisoformat(range_start).date()
    return [(start + timedelta(days=offset)).isoformat() for offset in range(count)]


def _next_local_midnight(as_of_utc: datetime, zone: ZoneInfo) -> datetime:
    """Return the next local midnight as a UTC instant (IANA-safe, DST-aware)."""
    local_now = as_of_utc.astimezone(zone)
    next_local_date = local_now.date() + timedelta(days=1)
    next_midnight_local = datetime.combine(
        next_local_date, datetime.min.time(), tzinfo=zone
    )
    return next_midnight_local.astimezone(UTC)
