"use client";

/**
 * Study-activity panel for My Day (issue #126).
 *
 * Shows the streaks, today's review count, the timezone control, and the
 * 365-day GitHub-style grid. The panel owns its loading/error/retry state and
 * never blocks studying. Dates arrive as calendar labels (YYYY-MM-DD) and are
 * rendered as labels — never parsed as UTC midnights.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  ACTIVITY_BUCKETS,
  BUCKET_LABELS,
  activityApi,
  browserTimezoneCandidate,
  intensityBucket,
  type ActivityResponse,
} from "@/lib/api/activity";

const WEEKDAY_LABELS = ["M", "T", "W", "T", "F", "S", "S"];
const MONTH_LABEL_EVERY_WEEKS = 4;

function bucketColor(bucket: number): string {
  switch (bucket) {
    case 1:
      return "color-mix(in srgb, var(--accent) 25%, transparent)";
    case 2:
      return "color-mix(in srgb, var(--accent) 50%, transparent)";
    case 3:
      return "color-mix(in srgb, var(--accent) 75%, transparent)";
    case 4:
      return "var(--accent)";
    default:
      return "var(--surface-raised, rgba(128,128,128,0.15))";
  }
}

interface GridCell {
  date: string;
  reviewCount: number;
  isToday: boolean;
  weekday: number;
  weekIndex: number;
  future: boolean;
}

function buildGrid(activity: ActivityResponse): GridCell[][] {
  const byDate = new Map(activity.days.map((day) => [day.date, day.review_count]));
  const start = activity.days[0].date;
  const [year, month, day] = start.split("-").map(Number);
  const startDate = new Date(Date.UTC(year, month - 1, day));

  // Monday-first columns (weeks), Monday=0..Sunday=6 rows.
  const leadingBlanks = (startDate.getUTCDay() + 6) % 7;
  const cells: GridCell[] = [];
  activity.days.forEach((day, index) => {
    const date = new Date(startDate);
    date.setUTCDate(startDate.getUTCDate() + index);
    cells.push({
      date: day.date,
      reviewCount: byDate.get(day.date) ?? day.review_count,
      isToday: day.date === activity.today,
      weekday: (date.getUTCDay() + 6) % 7,
      weekIndex: Math.floor((index + leadingBlanks) / 7),
      future: false,
    });
  });

  const totalWeeks = cells[cells.length - 1].weekIndex + 1;
  const weeks: GridCell[][] = Array.from({ length: totalWeeks }, () =>
    Array.from({ length: 7 }, () => ({
      date: "",
      reviewCount: 0,
      isToday: false,
      weekday: 0,
      weekIndex: 0,
      future: true,
    }))
  );
  for (const cell of cells) {
    weeks[cell.weekIndex][cell.weekday] = cell;
  }
  return weeks;
}

function monthLabelForWeek(weekCells: GridCell[]): string | null {
  const firstReal = weekCells.find((cell) => !cell.future);
  if (!firstReal) return null;
  const [year, month] = firstReal.date.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, 1));
  return date.toLocaleDateString(undefined, { month: "short", timeZone: "UTC" });
}

function formatDateLabel(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.toLocaleDateString(undefined, {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function pluralReviews(count: number): string {
  return count === 1 ? "1 review" : `${count} reviews`;
}

export default function StudyActivityPanel() {
  const [activity, setActivity] = useState<ActivityResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSavingTimezone, setIsSavingTimezone] = useState(false);
  const [candidateZone, setCandidateZone] = useState<string>("UTC");
  const [showZonePicker, setShowZonePicker] = useState(false);
  const requestRef = useRef(0);
  const midnightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    const requestId = ++requestRef.current;
    try {
      const fresh = await activityApi.getActivity();
      if (requestId !== requestRef.current) return;
      setActivity(fresh);
      setError(null);
    } catch {
      if (requestId !== requestRef.current) return;
      // A failed refresh retains the last successful result with an error
      // indication; a failed first load shows the retry state.
      setError((previous) => previous ?? "Study activity could not be loaded.");
      setActivity((current) => current);
    } finally {
      if (requestId === requestRef.current) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    setCandidateZone(browserTimezoneCandidate());
    void load();
    return () => {
      requestRef.current += 1;
    };
  }, [load]);

  // Refresh on tab foreground (studies elsewhere may have changed activity).
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [load]);

  // One timer for the next local midnight; no polling.
  useEffect(() => {
    if (!activity) return;
    const delay = Math.max(
      0,
      new Date(activity.next_day_starts_at).getTime() - Date.now()
    );
    midnightTimerRef.current = setTimeout(() => void load(), delay + 1000);
    return () => {
      if (midnightTimerRef.current) clearTimeout(midnightTimerRef.current);
    };
  }, [activity, load]);

  const weeks = useMemo(() => (activity ? buildGrid(activity) : []), [activity]);

  const saveTimezone = useCallback(
    async (zone: string) => {
      setIsSavingTimezone(true);
      try {
        await activityApi.saveTimezone(zone);
        setShowZonePicker(false);
        await load();
      } catch {
        // Keep the picker open; the failed save keeps the previous state.
      } finally {
        setIsSavingTimezone(false);
      }
    },
    [load]
  );

  if (isLoading && !activity) {
    return (
      <section aria-busy="true" aria-label="Study activity">
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-5 w-5 animate-spin" style={{ color: "var(--muted)" }} />
        </div>
      </section>
    );
  }

  if (!activity) {
    return (
      <section aria-label="Study activity">
        <div className="text-center py-10 space-y-3">
          <p style={{ color: "var(--muted)" }}>
            {error ?? "Study activity could not be loaded."}
          </p>
          <Button variant="outline" onClick={() => void load()}>
            Try again
          </Button>
        </div>
      </section>
    );
  }

  const hasTimezone = activity.timezone_is_set;
  const todayActive = activity.today_review_count > 0;
  const streakMessage =
    todayActive || activity.current_streak === 0
      ? null
      : `Review today to keep your ${activity.current_streak}-day streak.`;

  return (
    <section aria-label="Study activity">
      <div className="flex items-baseline justify-between gap-4 mb-4">
        <h2
          className="serif"
          style={{ fontSize: 22, fontWeight: 500, letterSpacing: "-0.01em" }}
        >
          Study activity
        </h2>
        <button
          type="button"
          className="mono"
          style={{ fontSize: 11, color: "var(--muted)", letterSpacing: "0.06em" }}
          onClick={() => setShowZonePicker((open) => !open)}
        >
          {hasTimezone ? activity.timezone : `${activity.timezone} (not set)`}
        </button>
      </div>

      {showZonePicker && (
        <div
          className="mb-4"
          style={{
            padding: 16,
            borderRadius: 12,
            border: "1px solid var(--line)",
            background: "var(--surface)",
          }}
        >
          <p style={{ fontSize: 13, color: "var(--muted)", marginBottom: 10 }}>
            Changing the timezone may change past dates and streaks. Detected:{" "}
            <span className="mono">{candidateZone}</span>
          </p>
          <div className="flex gap-2">
            <input
              aria-label="Timezone"
              value={candidateZone}
              onChange={(event) => setCandidateZone(event.target.value)}
              className="mono"
              style={{
                flex: 1,
                padding: "8px 10px",
                borderRadius: 8,
                border: "1px solid var(--line)",
                background: "transparent",
                color: "inherit",
                fontSize: 13,
              }}
            />
            <Button
              size="sm"
              disabled={isSavingTimezone || !candidateZone.trim()}
              onClick={() => void saveTimezone(candidateZone.trim())}
            >
              {isSavingTimezone ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      )}

      <div
        style={{
          padding: "clamp(20px, 4vw, 32px)",
          borderRadius: 18,
          background: "var(--surface)",
          border: "1px solid var(--line)",
        }}
      >
        <div className="flex flex-wrap items-end gap-x-10 gap-y-4 mb-6">
          <div>
            <div
              className="numeral"
              style={{ fontSize: 44, lineHeight: 1, fontWeight: 500 }}
            >
              {activity.current_streak}
            </div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
              day streak
            </div>
          </div>
          <div>
            <div
              className="numeral"
              style={{ fontSize: 44, lineHeight: 1, fontWeight: 500 }}
            >
              {activity.longest_streak}
            </div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
              best recorded
            </div>
          </div>
          <div>
            <div
              className="numeral"
              style={{ fontSize: 44, lineHeight: 1, fontWeight: 500 }}
            >
              {activity.today_review_count}
            </div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
              reviews today
            </div>
          </div>
        </div>

        {streakMessage && (
          <p style={{ fontSize: 13, color: "var(--warn)", marginBottom: 12 }}>
            {streakMessage}
          </p>
        )}
        {todayActive && (
          <p style={{ fontSize: 13, color: "var(--muted)", marginBottom: 12 }}>
            Today&apos;s study is recorded.
          </p>
        )}
        {error && (
          <p style={{ fontSize: 12, color: "var(--warn)", marginBottom: 12 }}>
            {error} Showing the last loaded data.
          </p>
        )}

        <div className="overflow-x-auto">
          <div
            role="img"
            aria-label={`Study activity grid from ${activity.range_start} to ${activity.range_end}`}
            style={{ display: "inline-block", minWidth: "100%" }}
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns: `repeat(${weeks.length}, 12px)`,
                gridAutoFlow: "column",
                gridTemplateRows: "repeat(7, 12px)",
                gap: 3,
              }}
            >
              {weeks.map((weekCells) => {
                const label = monthLabelForWeek(weekCells);
                return weekCells.map((cell, row) => (
                  <div
                    key={`${weekCells[0]?.date || "blank"}-${row}`}
                    title={
                      cell.future
                        ? undefined
                        : `${formatDateLabel(cell.date)}: ${pluralReviews(cell.reviewCount)}`
                    }
                    style={{
                      width: 12,
                      height: 12,
                      borderRadius: 3,
                      background: cell.future
                        ? "transparent"
                        : bucketColor(intensityBucket(cell.reviewCount)),
                      outline: cell.isToday ? "2px solid var(--accent)" : undefined,
                      outlineOffset: 1,
                    }}
                    data-date={cell.future ? undefined : cell.date}
                    data-month-label={label && row === 0 ? label : undefined}
                  />
                ));
              })}
            </div>
          </div>
        </div>

        <div
          className="flex items-center justify-between gap-4 mt-4"
          style={{ fontSize: 11, color: "var(--muted)" }}
        >
          <span className="mono" style={{ letterSpacing: "0.06em" }}>
            {activity.range_start} → {activity.range_end}
          </span>
          <div className="flex items-center gap-2">
            <span>Less</span>
            {ACTIVITY_BUCKETS.map((bucket) => (
              <span
                key={bucket}
                title={BUCKET_LABELS[bucket]}
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 3,
                  background: bucketColor(bucket),
                  display: "inline-block",
                }}
              />
            ))}
            <span>More</span>
          </div>
        </div>

        <p style={{ fontSize: 11, color: "var(--muted)", marginTop: 10 }}>
          Best streak counts all available recorded history. Reviews removed
          before activity tracking cannot be recovered.
        </p>
      </div>
    </section>
  );
}

export { WEEKDAY_LABELS, MONTH_LABEL_EVERY_WEEKS };
