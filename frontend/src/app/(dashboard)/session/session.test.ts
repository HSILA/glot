/**
 * Session helpers — API contract and pure-logic tests.
 *
 * The project does not have a React/DOM render environment, so these tests
 * guard the session page's building blocks (queue, seed, progress, and the
 * API calls the page makes) rather than testing the component directly.
 *
 * What is covered:
 *   - the in-session queue requeues failed cards, carries fresh card objects,
 *     and tracks progress correctly
 *   - the per-session seed is scoped (user + deck), persisted, reused,
 *     cleared correctly, and survives unusable storage
 *   - session progress is computed from the server's remaining count
 *   - the due endpoints the session uses (batch + legacy list) and the
 *     review receipt fields
 *
 * What is NOT covered here (requires a DOM/React render environment):
 *   - Rating buttons are visible only after the card is flipped
 *   - Clicking a rating button calls reviewCard and advances the session
 *   - Keyboard shortcuts 1-4 trigger the correct rating exactly once
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { __resetForTests } from "@/lib/api/fetch-with-auth";
import {
  cardsApi,
  type Card,
  type DueSummary,
  type NextStatesResponse,
} from "@/lib/api/cards";
import { getSessionProgress } from "./session-progress";
import {
  advanceQueue,
  shouldRequeue,
  REQUEUE_RATINGS,
  REQUEUE_GAP,
} from "./session-queue";
import {
  clearSessionSeed,
  getOrCreateSessionSeed,
  MAX_SEED,
  randomSeed,
  sessionSeedKey,
  type SeedStorage,
} from "./session-seed";
import {
  installFetchMock,
  installWindowMock,
  jsonResponse,
  restoreFetch,
  restoreWindow,
  type FetchMock,
} from "@/lib/test-utils";

function makeCard(overrides: Partial<Card> = {}): Card {
  return {
    id: 1,
    sequence: 1,
    front_content: "Q",
    back_content: "A",
    meta_data: {},
    tags: [],
    deck_id: 5,
    difficulty: 0.3,
    stability: 4.0,
    state: "review",
    reps: 3,
    lapses: 0,
    review_version: 0,
    last_review_at: "2026-05-10T10:00:00Z",
    next_review_at: "2026-05-17T10:00:00Z",
    created_at: "2025-01-01T00:00:00Z",
    updated_at: "2025-05-10T10:00:00Z",
    ...overrides,
  };
}

function makeNextStates(): NextStatesResponse {
  const info = { interval_days: 1, new_difficulty: 0.3, new_stability: 1.5 };
  return { again: info, hard: info, good: info, easy: info };
}

function makeSummary(total: number, deckId: number | null = null): DueSummary {
  return {
    scheduled_due_count: total,
    new_count: 0,
    total,
    as_of: "2026-09-29T12:00:00Z",
    deck_id: deckId,
  };
}

function reviewBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    card: makeCard(),
    next_states: makeNextStates(),
    message: "ok",
    request_id: "req-1",
    review_id: 10,
    replayed: false,
    summary: makeSummary(1),
    ...overrides,
  };
}

let fetchMock: FetchMock;

beforeEach(() => {
  __resetForTests();
  installWindowMock();
  fetchMock = installFetchMock();
});

afterEach(() => {
  restoreFetch();
  restoreWindow();
});

describe("session — progress display", () => {
  test("computes progress from completed plus the server's remaining count", () => {
    const start = getSessionProgress({ remaining: 3, completed: 0, hasCurrentCard: true });
    expect(start).toMatchObject({ remaining: 3, completed: 0, progressPercent: 0 });

    const mid = getSessionProgress({ remaining: 2, completed: 1, hasCurrentCard: true });
    expect(mid.progressPercent).toBeCloseTo(100 / 3);

    const done = getSessionProgress({ remaining: 0, completed: 3, hasCurrentCard: false });
    expect(done).toMatchObject({ remaining: 0, completed: 3, progressPercent: 100 });
  });

  test("shows zero progress for an empty session", () => {
    expect(
      getSessionProgress({ remaining: 0, completed: 0, hasCurrentCard: false }),
    ).toMatchObject({ remaining: 0, completed: 0, progressPercent: 0 });
  });

  test("treats an unknown remaining count as zero, never NaN", () => {
    const unknown = getSessionProgress({ remaining: null, completed: 0, hasCurrentCard: true });
    expect(Number.isNaN(unknown.progressPercent)).toBe(false);
    expect(unknown.progressPercent).toBe(0);
  });

  test("progress can move backward when new work appears (stays truthful)", () => {
    const before = getSessionProgress({ remaining: 1, completed: 4, hasCurrentCard: true });
    const after = getSessionProgress({ remaining: 2, completed: 4, hasCurrentCard: true });
    expect(before.progressPercent).toBeGreaterThan(after.progressPercent);
  });

  test("estimates minutes from the remaining count", () => {
    expect(
      getSessionProgress({ remaining: 8, completed: 0, hasCurrentCard: true }).estimatedMinutes,
    ).toBe(2);
  });
});

describe("session — due-batch loading", () => {
  test("requests the first batch with limit 100 and the stable seed", async () => {
    fetchMock.enqueue(() =>
      jsonResponse({ items: [makeCard()], summary: makeSummary(7), limit: 100 }),
    );

    const batch = await cardsApi.getDueBatch({ deck_id: 5, limit: 100, seed: 123 });

    const url = new URL(fetchMock.calls[0].url, "http://localhost");
    expect(url.pathname).toBe("/api/v1/cards/due/batch");
    expect(url.searchParams.get("deck_id")).toBe("5");
    expect(url.searchParams.get("limit")).toBe("100");
    expect(url.searchParams.get("seed")).toBe("123");
    expect(batch.items).toHaveLength(1);
    expect(batch.summary.total).toBe(7);
  });

  test("a confirmed-empty batch is the only empty signal (total 0)", async () => {
    fetchMock.enqueue(() =>
      jsonResponse({ items: [], summary: makeSummary(0), limit: 100 }),
    );

    const batch = await cardsApi.getDueBatch({ limit: 100 });

    expect(batch.items).toHaveLength(0);
    expect(batch.summary.total).toBe(0);
  });

  test("the summary endpoint returns the same count shape as the dashboard", async () => {
    fetchMock.enqueue(() => jsonResponse(makeSummary(250)));

    const summary = await cardsApi.getDueSummary();

    expect(summary.total).toBe(250);
  });
});

describe("session — legacy due-card loading", () => {
  test("requests limit:100 for a deck-specific session (not the API default of 20)", async () => {
    fetchMock.enqueue(() => jsonResponse([makeCard()]));

    const cards = await cardsApi.getDueCards({ deck_id: 5, limit: 100 });

    expect(cards).toHaveLength(1);
    const url = new URL(fetchMock.calls[0].url, "http://localhost");
    expect(url.searchParams.get("deck_id")).toBe("5");
    expect(url.searchParams.get("limit")).toBe("100");
  });

  test("omits deck_id and requests limit:100 for a mixed-review session", async () => {
    fetchMock.enqueue(() => jsonResponse([makeCard(), makeCard({ id: 2 })]));

    const cards = await cardsApi.getDueCards({ limit: 100 });

    expect(cards).toHaveLength(2);
    expect(fetchMock.calls[0].url).toBe("/api/v1/cards/due?limit=100");
  });

  test("returns an empty array when no cards are due", async () => {
    fetchMock.enqueue(() => jsonResponse([]));

    const cards = await cardsApi.getDueCards({ limit: 100 });

    expect(cards).toHaveLength(0);
  });
});

describe("session — rating a card", () => {
  test.each([1, 2, 3, 4] as const)(
    "rating %i is forwarded verbatim with review_duration_ms and the request id",
    async (rating) => {
      fetchMock.enqueue(() => jsonResponse(reviewBody()));

      await cardsApi.reviewCard(1, {
        rating,
        review_duration_ms: 5000,
        request_id: "req-abc",
      });

      const call = fetchMock.calls[0];
      expect(call.url).toBe("/api/v1/cards/1/review");
      expect(call.init?.method).toBe("POST");
      const body = JSON.parse(call.init?.body as string);
      expect(body.rating).toBe(rating);
      expect(body.review_duration_ms).toBe(5000);
      expect(body.request_id).toBe("req-abc");
    },
  );

  test("a replayed response carries the receipt so the client can settle the outbox", async () => {
    fetchMock.enqueue(() =>
      jsonResponse(reviewBody({ replayed: true, request_id: "req-abc" })),
    );

    const result = await cardsApi.reviewCard(1, { rating: 3, request_id: "req-abc" });

    expect(result.replayed).toBe(true);
    expect(result.request_id).toBe("req-abc");
  });

  test("surfaces the API error detail when the review request fails", async () => {
    fetchMock.enqueue(() =>
      jsonResponse({ detail: "Card not found" }, { status: 404 }),
    );

    await expect(
      cardsApi.reviewCard(999, { rating: 1, review_duration_ms: 1000, request_id: "req-x" }),
    ).rejects.toThrow("Card not found");
  });
});

describe("session — in-session requeue", () => {
  test("Again is the only requeue rating by default", () => {
    expect(REQUEUE_RATINGS).toEqual([1]);
    expect(shouldRequeue(1)).toBe(true);
    expect(shouldRequeue(2)).toBe(false);
    expect(shouldRequeue(3)).toBe(false);
    expect(shouldRequeue(4)).toBe(false);
  });

  test.each([2, 3, 4] as const)(
    "a passing rating (%i) removes the head card from the queue",
    (rating) => {
      expect(advanceQueue(["a", "b", "c"], rating)).toEqual(["b", "c"]);
    },
  );

  test("Again reinserts the failed card behind the requeue gap", () => {
    // Gap of 1 so the reinserted position is easy to assert.
    expect(advanceQueue(["a", "b", "c", "d"], 1, 1)).toEqual(["b", "a", "c", "d"]);
  });

  test("Again uses the default gap of 3 when not overridden", () => {
    const queue = ["a", "b", "c", "d", "e"];
    expect(REQUEUE_GAP).toBe(3);
    expect(advanceQueue(queue, 1)).toEqual(["b", "c", "d", "a", "e"]);
  });

  test("a failed card is appended at the end when fewer cards than the gap remain", () => {
    expect(advanceQueue(["a", "b"], 1, 3)).toEqual(["b", "a"]);
  });

  test("the only remaining card keeps being shown until it is passed", () => {
    expect(advanceQueue(["a"], 1)).toEqual(["a"]);
    expect(advanceQueue(["a"], 3)).toEqual([]);
  });

  test("does not mutate the input queue", () => {
    const queue = ["a", "b", "c"];
    advanceQueue(queue, 1, 1);
    expect(queue).toEqual(["a", "b", "c"]);
  });

  test("a replacement card object takes the requeued slot (fresh review_version)", () => {
    const shown = { id: 1, review_version: 0 };
    const updated = { id: 1, review_version: 1 };
    const other = { id: 2, review_version: 0 };

    expect(advanceQueue([shown, other], 1, 3, updated)).toEqual([other, updated]);
    // Passing ratings still drop the head; the replacement is ignored.
    expect(advanceQueue([shown, other], 3, 3, updated)).toEqual([other]);
  });

  test("progress counts distinct passed cards and never overflows when cards requeue", () => {
    // Session of 2 cards. Card A is failed once (requeued), then both pass.
    // Completed count must reach exactly the session total, never exceed it.
    const total = 2;
    let queue = ["a", "b"];
    let completed = 0;

    const rate = (rating: 1 | 2 | 3 | 4) => {
      queue = advanceQueue(queue, rating);
      if (!shouldRequeue(rating)) completed = Math.min(completed + 1, total);
    };

    rate(1); // A failed → requeued, not counted
    expect(completed).toBe(0);
    expect(queue).toEqual(["b", "a"]);

    rate(3); // B passed
    rate(3); // A passed
    expect(completed).toBe(2);
    expect(queue).toEqual([]);

    expect(
      getSessionProgress({ remaining: 0, completed, hasCurrentCard: false }),
    ).toMatchObject({ remaining: 0, completed: 2, progressPercent: 100 });
  });
});

/** In-memory `SeedStorage` standing in for browser storage. */
function makeStorage(initial: Record<string, string> = {}): SeedStorage & {
  store: Map<string, string>;
} {
  const store = new Map(Object.entries(initial));
  return {
    store,
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => void store.set(key, value),
    removeItem: (key) => void store.delete(key),
  };
}

describe("session — per-session seed", () => {
  test("scopes the storage key per user, per deck, and apart from mixed review", () => {
    const mixed = sessionSeedKey(7, undefined);
    const deck1 = sessionSeedKey(7, 1);
    const deck2 = sessionSeedKey(7, 2);
    const otherUser = sessionSeedKey(8, 1);

    expect(new Set([mixed, deck1, deck2, otherUser]).size).toBe(4);
    // Stable across calls so reload reads back the same slot.
    expect(sessionSeedKey(7, 1)).toBe(deck1);
  });

  test("randomSeed stays a non-negative integer within seed bounds", () => {
    expect(MAX_SEED).toBe(0x7fffffff);
    for (let i = 0; i < 1000; i += 1) {
      const seed = randomSeed();
      expect(Number.isInteger(seed)).toBe(true);
      expect(seed).toBeGreaterThanOrEqual(0);
      expect(seed).toBeLessThanOrEqual(MAX_SEED);
    }
  });

  test("creates and persists a fresh seed when none is stored", () => {
    const storage = makeStorage();

    const seed = getOrCreateSessionSeed(storage, 7, undefined, () => 42);

    expect(seed).toBe(42);
    expect(storage.getItem(sessionSeedKey(7, undefined))).toBe("42");
  });

  test("reuses the stored seed across calls (interruption-friendly)", () => {
    const storage = makeStorage();
    const generate = () => Math.floor(Math.random() * MAX_SEED);

    const first = getOrCreateSessionSeed(storage, 7, undefined, generate);
    const second = getOrCreateSessionSeed(storage, 7, undefined, generate);

    expect(second).toBe(first);
  });

  test("deck and mixed sessions keep independent seeds", () => {
    const storage = makeStorage();

    const deckSeed = getOrCreateSessionSeed(storage, 7, 5, () => 11);
    const mixedSeed = getOrCreateSessionSeed(storage, 7, undefined, () => 22);

    expect(deckSeed).toBe(11);
    expect(mixedSeed).toBe(22);
  });

  test("users on a shared device keep independent seeds", () => {
    const storage = makeStorage();

    const a = getOrCreateSessionSeed(storage, 7, undefined, () => 11);
    const b = getOrCreateSessionSeed(storage, 8, undefined, () => 22);

    expect(a).toBe(11);
    expect(b).toBe(22);
    expect(storage.getItem(sessionSeedKey(8, undefined))).toBe("22");
  });

  test("regenerates when the stored value is corrupt", () => {
    const storage = makeStorage({ [sessionSeedKey(7, undefined)]: "not-a-number" });

    const seed = getOrCreateSessionSeed(storage, 7, undefined, () => 99);

    expect(seed).toBe(99);
    expect(storage.getItem(sessionSeedKey(7, undefined))).toBe("99");
  });

  test("regenerates when the stored value is outside backend seed bounds", () => {
    const storage = makeStorage({ [sessionSeedKey(7, undefined)]: String(MAX_SEED + 1) });

    const seed = getOrCreateSessionSeed(storage, 7, undefined, () => 123);

    expect(seed).toBe(123);
    expect(storage.getItem(sessionSeedKey(7, undefined))).toBe("123");
  });

  test("clearing drops only the matching scope's seed", () => {
    const storage = makeStorage();
    getOrCreateSessionSeed(storage, 7, undefined, () => 11);
    getOrCreateSessionSeed(storage, 7, 5, () => 22);

    clearSessionSeed(storage, 7, undefined);

    expect(storage.getItem(sessionSeedKey(7, undefined))).toBeNull();
    expect(storage.getItem(sessionSeedKey(7, 5))).toBe("22");

    // After clearing, the next session draws a fresh seed.
    const fresh = getOrCreateSessionSeed(storage, 7, undefined, () => 33);
    expect(fresh).toBe(33);
  });

  test("falls back to a stable in-memory seed when storage throws", () => {
    const broken: SeedStorage = {
      getItem: () => {
        throw new Error("storage denied");
      },
      setItem: () => {
        throw new Error("storage denied");
      },
      removeItem: () => {
        throw new Error("storage denied");
      },
    };

    const first = getOrCreateSessionSeed(broken, 17, undefined, () => 5);
    const second = getOrCreateSessionSeed(broken, 17, undefined, () => 6);

    expect(first).toBe(5);
    // Stable within the page instead of reshuffling on every call.
    expect(second).toBe(5);
    expect(() => clearSessionSeed(broken, 17, undefined)).not.toThrow();
  });

  test("accepts null storage (browser storage unavailable entirely)", () => {
    const seed = getOrCreateSessionSeed(null, 18, undefined, () => 7);
    expect(seed).toBe(7);

    const again = getOrCreateSessionSeed(null, 18, undefined, () => 8);
    expect(again).toBe(7);
  });
});
