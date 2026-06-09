/**
 * Session page — API contract tests.
 *
 * The project does not have a React/DOM render environment, so these tests
 * guard the API layer as the session page uses it rather than testing the
 * component directly. They are colocated with the session page so they are
 * easy to extend when component-level tests become feasible.
 *
 * What is covered:
 *   - getDueCards with limit:100 (the session overrides the API default of 20)
 *   - getDueCards with and without deck_id (single-deck vs mixed-review modes)
 *   - Empty due-cards list (the "All caught up" state)
 *   - reviewCard sends all four rating values (1-4) plus review_duration_ms
 *   - reviewCard failure surfaces a meaningful error message
 *   - the in-session queue requeues failed cards and tracks progress correctly
 *   - the per-session seed is scoped, persisted, reused, and cleared correctly
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
  test("keeps the original session total while advancing through reviewed cards", () => {
    const firstCard = getSessionProgress({ sessionTotal: 3, reviewedCount: 0, hasCurrentCard: true });
    expect(firstCard).toMatchObject({
      cardNumber: 1,
      totalCards: 3,
      remaining: 3,
    });
    expect(firstCard.progressPercent).toBeCloseTo(100 / 3);

    const secondCard = getSessionProgress({ sessionTotal: 3, reviewedCount: 1, hasCurrentCard: true });
    expect(secondCard).toMatchObject({
      cardNumber: 2,
      totalCards: 3,
      remaining: 2,
    });
    expect(secondCard.progressPercent).toBeCloseTo(200 / 3);

    expect(getSessionProgress({ sessionTotal: 3, reviewedCount: 3, hasCurrentCard: false })).toMatchObject({
      cardNumber: 3,
      totalCards: 3,
      progressPercent: 100,
      remaining: 0,
    });
  });

  test("shows zero progress for an empty session", () => {
    expect(getSessionProgress({ sessionTotal: 0, reviewedCount: 0, hasCurrentCard: false })).toMatchObject({
      cardNumber: 0,
      totalCards: 0,
      progressPercent: 0,
      remaining: 0,
    });
  });
});

describe("session — due-card loading", () => {
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
    "rating %i is forwarded verbatim with review_duration_ms",
    async (rating) => {
      fetchMock.enqueue(() =>
        jsonResponse({
          card: makeCard(),
          next_states: makeNextStates(),
          message: "ok",
        }),
      );

      await cardsApi.reviewCard(1, { rating, review_duration_ms: 5000 });

      const call = fetchMock.calls[0];
      expect(call.url).toBe("/api/v1/cards/1/review");
      expect(call.init?.method).toBe("POST");
      const body = JSON.parse(call.init?.body as string);
      expect(body.rating).toBe(rating);
      expect(body.review_duration_ms).toBe(5000);
    },
  );

  test("surfaces the API error detail when the review request fails", async () => {
    fetchMock.enqueue(() =>
      jsonResponse({ detail: "Card not found" }, { status: 404 }),
    );

    await expect(
      cardsApi.reviewCard(999, { rating: 1, review_duration_ms: 1000 }),
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

    expect(getSessionProgress({ sessionTotal: total, reviewedCount: completed, hasCurrentCard: false })).toMatchObject({
      cardNumber: 2,
      totalCards: 2,
      progressPercent: 100,
      remaining: 0,
    });
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
  test("scopes the storage key per deck, and apart from mixed review", () => {
    const mixed = sessionSeedKey(undefined);
    const deck1 = sessionSeedKey(1);
    const deck2 = sessionSeedKey(2);

    expect(new Set([mixed, deck1, deck2]).size).toBe(3);
    // Stable across calls so reload reads back the same slot.
    expect(sessionSeedKey(1)).toBe(deck1);
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

    const seed = getOrCreateSessionSeed(storage, 7, () => 42);

    expect(seed).toBe(42);
    expect(storage.getItem(sessionSeedKey(7))).toBe("42");
  });

  test("reuses the stored seed across calls (interruption-friendly)", () => {
    const storage = makeStorage();
    const generate = () => Math.floor(Math.random() * MAX_SEED);

    const first = getOrCreateSessionSeed(storage, 7, generate);
    const second = getOrCreateSessionSeed(storage, 7, generate);

    expect(second).toBe(first);
  });

  test("deck and mixed sessions keep independent seeds", () => {
    const storage = makeStorage();

    const deckSeed = getOrCreateSessionSeed(storage, 7, () => 11);
    const mixedSeed = getOrCreateSessionSeed(storage, undefined, () => 22);

    expect(deckSeed).toBe(11);
    expect(mixedSeed).toBe(22);
  });

  test("regenerates when the stored value is corrupt", () => {
    const storage = makeStorage({ [sessionSeedKey(7)]: "not-a-number" });

    const seed = getOrCreateSessionSeed(storage, 7, () => 99);

    expect(seed).toBe(99);
    expect(storage.getItem(sessionSeedKey(7))).toBe("99");
  });

  test("regenerates when the stored value is outside backend seed bounds", () => {
    const storage = makeStorage({ [sessionSeedKey(7)]: String(MAX_SEED + 1) });

    const seed = getOrCreateSessionSeed(storage, 7, () => 123);

    expect(seed).toBe(123);
    expect(storage.getItem(sessionSeedKey(7))).toBe("123");
  });

  test("clearing drops only the matching scope's seed", () => {
    const storage = makeStorage();
    getOrCreateSessionSeed(storage, 7, () => 11);
    getOrCreateSessionSeed(storage, undefined, () => 22);

    clearSessionSeed(storage, 7);

    expect(storage.getItem(sessionSeedKey(7))).toBeNull();
    expect(storage.getItem(sessionSeedKey(undefined))).toBe("22");

    // After clearing, the next session draws a fresh seed.
    const fresh = getOrCreateSessionSeed(storage, 7, () => 33);
    expect(fresh).toBe(33);
  });
});
