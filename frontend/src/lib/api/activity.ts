import { parseApiError } from "@/lib/api-error";
import { fetchWithAuth } from "@/lib/api/fetch-with-auth";

export interface ActivityDay {
  date: string;
  review_count: number;
}

export interface ActivityResponse {
  as_of: string;
  timezone: string;
  timezone_is_set: boolean;
  today: string;
  range_start: string;
  range_end: string;
  next_day_starts_at: string;
  today_review_count: number;
  current_streak: number;
  longest_streak: number;
  last_active_date: string | null;
  days: ActivityDay[];
}

export interface SaveTimezoneRequest {
  timezone: string;
}

const API_BASE = "/api/v1";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Date-only strings are calendar labels, never browser-local UTC parses. */
export function assertDateString(value: unknown, context: string): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${context}: invalid date`);
  }
  return value;
}

function assertDay(value: unknown, context: string): ActivityDay {
  if (!isObject(value)) throw new Error(`${context}: expected object`);
  return {
    date: assertDateString(value.date, `${context}.date`),
    review_count:
      typeof value.review_count === "number" && Number.isInteger(value.review_count) && value.review_count >= 0
        ? value.review_count
        : (() => {
            throw new Error(`${context}: invalid review_count`);
          })(),
  };
}

function assertActivity(value: unknown, context = "Activity"): ActivityResponse {
  if (!isObject(value)) throw new Error(`${context}: expected object`);
  if (!Array.isArray(value.days) || value.days.length !== 365) {
    throw new Error(`${context}: expected 365 days`);
  }
  const days = value.days.map((day, index) => assertDay(day, `${context}.days[${index}]`));
  if (typeof value.timezone !== "string") throw new Error(`${context}: invalid timezone`);
  if (typeof value.timezone_is_set !== "boolean") throw new Error(`${context}: invalid timezone_is_set`);
  if (typeof value.as_of !== "string") throw new Error(`${context}: invalid as_of`);
  if (typeof value.next_day_starts_at !== "string") throw new Error(`${context}: invalid next_day_starts_at`);
  if (typeof value.today_review_count !== "number") throw new Error(`${context}: invalid today_review_count`);
  if (typeof value.current_streak !== "number") throw new Error(`${context}: invalid current_streak`);
  if (typeof value.longest_streak !== "number") throw new Error(`${context}: invalid longest_streak`);
  if (value.last_active_date !== null && typeof value.last_active_date !== "string") {
    throw new Error(`${context}: invalid last_active_date`);
  }
  return {
    as_of: value.as_of,
    timezone: value.timezone,
    timezone_is_set: value.timezone_is_set,
    today: assertDateString(value.today, `${context}.today`),
    range_start: assertDateString(value.range_start, `${context}.range_start`),
    range_end: assertDateString(value.range_end, `${context}.range_end`),
    next_day_starts_at: value.next_day_starts_at,
    today_review_count: value.today_review_count,
    current_streak: value.current_streak,
    longest_streak: value.longest_streak,
    last_active_date: value.last_active_date,
    days,
  };
}

export function parseActivity(value: unknown, context = "Activity"): ActivityResponse {
  return assertActivity(value, context);
}

function intensityBucket(count: number): 0 | 1 | 2 | 3 | 4 {
  if (count <= 0) return 0;
  if (count <= 4) return 1;
  if (count <= 9) return 2;
  if (count <= 19) return 3;
  return 4;
}

export const ACTIVITY_BUCKETS = [0, 1, 2, 3, 4] as const;
export const BUCKET_LABELS: Record<number, string> = {
  0: "0",
  1: "1–4",
  2: "5–9",
  3: "10–19",
  4: "20+",
};

export { intensityBucket };

export function browserTimezoneCandidate(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export class ActivityApi {
  private async parseError(response: Response, fallback: string): Promise<never> {
    const data = await response.json().catch(() => null);
    if (data) {
      throw new Error(parseApiError(data));
    }
    throw new Error(fallback);
  }

  async getActivity(): Promise<ActivityResponse> {
    const response = await fetchWithAuth(`${API_BASE}/activity`, {
      credentials: "include",
      cache: "no-store",
    });

    if (!response.ok) {
      await this.parseError(response, "Failed to fetch study activity");
    }

    const data = await response.json();
    return parseActivity(data, "Study activity response");
  }

  async saveTimezone(timezone: string): Promise<void> {
    const response = await fetchWithAuth(`${API_BASE}/settings`, {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ timezone }),
    });

    if (!response.ok) {
      await this.parseError(response, "Failed to save timezone");
    }
  }
}

export const activityApi = new ActivityApi();
