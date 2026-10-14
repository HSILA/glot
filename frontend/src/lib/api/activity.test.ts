/**
 * Tests for the activity API client (parsing, buckets, timezone candidate).
 */

import { describe, expect, test } from "bun:test";

import {
  ACTIVITY_BUCKETS,
  assertDateString,
  browserTimezoneCandidate,
  intensityBucket,
  parseActivity,
} from "./activity";

function makeActivity(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const start = new Date(Date.UTC(2025, 5, 3));
  const days = Array.from({ length: 365 }, (_, index) => {
    const date = new Date(start);
    date.setUTCDate(start.getUTCDate() + index);
    return { date: date.toISOString().slice(0, 10), review_count: 0 };
  });
  return {
    as_of: "2026-06-01T12:00:00Z",
    timezone: "UTC",
    timezone_is_set: false,
    today: "2026-06-01",
    range_start: "2025-06-03",
    range_end: "2026-06-01",
    next_day_starts_at: "2026-06-02T04:00:00Z",
    today_review_count: 3,
    current_streak: 2,
    longest_streak: 5,
    last_active_date: "2026-06-01",
    days,
    ...overrides,
  };
}

describe("parseActivity", () => {
  test("accepts a valid 365-day payload", () => {
    const parsed = parseActivity(makeActivity());
    expect(parsed.days).toHaveLength(365);
    expect(parsed.timezone).toBe("UTC");
  });

  test("rejects a 364-day payload", () => {
    const short = makeActivity();
    (short.days as unknown[]).pop();
    expect(() => parseActivity(short)).toThrow();
  });

  test("rejects non-date strings", () => {
    const bad = makeActivity({ today: "not-a-date" });
    expect(() => parseActivity(bad)).toThrow();
  });

  test("rejects negative counts", () => {
    const bad = makeActivity();
    (bad.days as { date: string; review_count: number }[])[10].review_count = -1;
    expect(() => parseActivity(bad)).toThrow();
  });

  test("accepts null last_active_date", () => {
    const parsed = parseActivity(makeActivity({ last_active_date: null }));
    expect(parsed.last_active_date).toBeNull();
  });
});

describe("assertDateString", () => {
  test("treats date-only strings as calendar labels, not UTC parses", () => {
    expect(assertDateString("2026-03-08", "x")).toBe("2026-03-08");
  });

  test("rejects timestamps and garbage", () => {
    expect(() => assertDateString("2026-03-08T04:00:00Z", "x")).toThrow();
    expect(() => assertDateString("2026-6-1", "x")).toThrow();
  });
});

describe("intensityBucket", () => {
  test("matches the issue's fixed buckets", () => {
    expect(intensityBucket(0)).toBe(0);
    expect(intensityBucket(1)).toBe(1);
    expect(intensityBucket(4)).toBe(1);
    expect(intensityBucket(5)).toBe(2);
    expect(intensityBucket(9)).toBe(2);
    expect(intensityBucket(10)).toBe(3);
    expect(intensityBucket(19)).toBe(3);
    expect(intensityBucket(20)).toBe(4);
    expect(intensityBucket(100)).toBe(4);
  });

  test("bucket list is complete", () => {
    expect([...ACTIVITY_BUCKETS]).toEqual([0, 1, 2, 3, 4]);
  });
});

describe("browserTimezoneCandidate", () => {
  test("returns a non-empty IANA-style string", () => {
    const candidate = browserTimezoneCandidate();
    expect(candidate.length).toBeGreaterThan(0);
    expect(candidate).not.toMatch(/^\+/);
  });
});
