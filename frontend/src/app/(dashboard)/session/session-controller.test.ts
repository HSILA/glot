/**
 * SessionController tests.
 *
 * The controller is DOM-free (api, storage, and clock are injected), so the
 * whole reliability state machine is tested here with fakes:
 *
 *   - batch continuation: an empty loaded queue never ends the session while
 *     due cards remain; only a confirmed-empty batch does
 *   - truthful counts: the shown number always comes from the server's
 *     summary, even when it is larger than the loaded batch
 *   - retry-safe submissions: ambiguous failures block progress, the retry
 *     reuses the same idempotency key, and definitive rejections (stale
 *     version, deleted card) reconcile instead of overwriting
 *   - settlement of reviews staged by earlier visits, before the first batch
 */

import { describe, expect, test } from "bun:test";

import type { Card, DueSummary } from "@/lib/api/cards";
import { ApiError } from "@/lib/api-error";
import {
  generateRequestId,
  SessionController,
  type ReviewAck,
  type SessionApi,
  type SessionState,
} from "./session-controller";
import {
  MemoryOutboxStorage,
  ReviewOutbox,
  type OutboxStorage,
  type PendingReview,
} from "./review-outbox";

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

function makeSummary(total: number, deckId: number | null = null): DueSummary {
  return {
    scheduled_due_count: total,
    new_count: 0,
    total,
    as_of: "2026-09-29T12:00:00Z",
    deck_id: deckId,
  };
}

interface ReviewCall {
  cardId: number;
  payload: {
    rating: number;
    review_duration_ms?: number;
    request_id: string;
    expected_review_version?: number;
    scope_deck_id?: number;
  };
}

/** Scripted SessionApi: each queue yields one outcome per call; empty = throw. */
class FakeApi implements SessionApi {
  batches: Array<{ items: Card[]; summary: DueSummary; limit: number } | Error> = [];
  summaries: Array<DueSummary | Error | Promise<DueSummary>> = [];
  reviews: Array<ReviewAck | Error | Promise<ReviewAck>> = [];
  reviewCalls: ReviewCall[] = [];
  batchCalls: Array<{ deck_id?: number; limit?: number; seed?: number }> = [];
  log: string[] = [];

  async getDueBatch(options: { deck_id?: number; limit?: number; seed?: number }) {
    this.log.push("batch");
    this.batchCalls.push(options);
    const next = this.batches.shift();
    if (!next) throw new Error("FakeApi: no batch queued");
    if (next instanceof Error) throw next;
    return next;
  }

  async getDueSummary() {
    this.log.push("summary");
    const next = this.summaries.shift();
    if (!next) throw new Error("FakeApi: no summary queued");
    if (next instanceof Error) throw next;
    return next;
  }

  async reviewCard(cardId: number, payload: ReviewCall["payload"]): Promise<ReviewAck> {
    this.log.push("review");
    this.reviewCalls.push({ cardId, payload });
    const next = this.reviews.shift();
    if (!next) throw new Error("FakeApi: no review queued");
    if (next instanceof Error) throw next;
    return next;
  }
}

function ack(
  card: Card,
  total: number | null,
  options: { replayed?: boolean; requestId?: string } = {},
): ReviewAck {
  return {
    card,
    request_id: options.requestId ?? "rid",
    review_id: 1,
    replayed: options.replayed ?? false,
    summary: total === null ? null : makeSummary(total),
  };
}

function makeHarness(
  api: FakeApi,
  storage: OutboxStorage = new MemoryOutboxStorage(),
  options: { now?: () => number } = {},
) {
  const states: SessionState[] = [];
  let clearedSeeds = 0;
  const outbox = new ReviewOutbox(storage);
  const controller = new SessionController({
    scope: { userId: 7 },
    api,
    outbox,
    getSeed: () => 123,
    clearSeed: () => {
      clearedSeeds += 1;
    },
    onState: (state) => states.push(state),
    submitTimeoutMs: 0,
    now:
      options.now ??
      (() => {
        let t = 1_000_000;
        return () => (t += 1000);
      })(),
  });
  return { controller, states, storage, outbox, clearedSeeds: () => clearedSeeds };
}

function stagedOp(overrides: Partial<PendingReview> = {}): PendingReview {
  return {
    request_id: "old-1",
    user_id: 7,
    card_id: 5,
    rating: 3,
    review_duration_ms: 2000,
    expected_review_version: 0,
    scope_deck_id: null,
    created_at: 1,
    ...overrides,
  };
}

describe("SessionController — batch continuation", () => {
  test("fetches the next batch when the loaded queue drains, then finishes only on a confirmed-empty batch", async () => {
    const api = new FakeApi();
    const c1 = makeCard({ id: 1 });
    const c2 = makeCard({ id: 2 });
    api.batches.push(
      { items: [c1], summary: makeSummary(2), limit: 100 },
      { items: [c2], summary: makeSummary(1), limit: 100 },
    );
    api.reviews.push(ack(makeCard({ id: 1, review_version: 1 }), 1));

    const h = makeHarness(api);
    await h.controller.start();
    expect(h.controller.getState().phase).toBe("active");
    expect(h.controller.getState().remaining).toBe(2);

    await h.controller.rate(3);

    const afterFirst = h.controller.getState();
    expect(afterFirst.phase).toBe("active");
    expect(afterFirst.queue.map((c) => c.id)).toEqual([2]);
    expect(afterFirst.remaining).toBe(1);
    // The continuation happened without an empty "caught up" state.
    expect(api.batchCalls.length).toBe(2);
    expect(h.states.some((s) => s.phase === "loading_more")).toBe(true);
    expect(h.states.some((s) => s.phase === "exhausted")).toBe(false);

    api.reviews.push(ack(makeCard({ id: 2, review_version: 1 }), 0));
    api.batches.push({ items: [], summary: makeSummary(0), limit: 100 });
    await h.controller.rate(3);

    expect(h.controller.getState().phase).toBe("exhausted");
    expect(h.controller.getState().remaining).toBe(0);
    expect(h.clearedSeeds()).toBe(1);
  });

  test("the shown count comes from the server snapshot, not the batch length", async () => {
    const api = new FakeApi();
    api.batches.push({ items: [makeCard()], summary: makeSummary(250), limit: 100 });

    const h = makeHarness(api);
    await h.controller.start();

    expect(h.controller.getState().remaining).toBe(250);
  });
});

describe("SessionController — truthful counts and requeue", () => {
  test("Again keeps the card due (count unchanged) and requeues the updated card object", async () => {
    const api = new FakeApi();
    api.batches.push({ items: [makeCard({ id: 1 })], summary: makeSummary(1), limit: 100 });
    api.reviews.push(ack(makeCard({ id: 1, review_version: 1 }), 1));

    const h = makeHarness(api);
    await h.controller.start();
    await h.controller.rate(1);

    const state = h.controller.getState();
    expect(state.completed).toBe(0);
    expect(state.remaining).toBe(1);
    expect(state.queue.map((c) => c.id)).toEqual([1]);
    expect(state.queue[0].review_version).toBe(1);

    // The second attempt reuses the fresh version from the requeued object.
    api.reviews.push(ack(makeCard({ id: 1, review_version: 2 }), 0));
    api.batches.push({ items: [], summary: makeSummary(0), limit: 100 });
    await h.controller.rate(3);

    expect(api.reviewCalls[0].payload.expected_review_version).toBe(0);
    expect(api.reviewCalls[1].payload.expected_review_version).toBe(1);
    expect(h.controller.getState().completed).toBe(1);
    expect(h.controller.getState().remaining).toBe(0);
  });

  test("a passing rating lowers the count and advances the queue", async () => {
    const api = new FakeApi();
    api.batches.push({
      items: [makeCard({ id: 1 }), makeCard({ id: 2 })],
      summary: makeSummary(2),
      limit: 100,
    });
    api.reviews.push(ack(makeCard({ id: 1, review_version: 1 }), 1));

    const h = makeHarness(api);
    await h.controller.start();
    await h.controller.rate(3);

    const state = h.controller.getState();
    expect(state.queue.map((c) => c.id)).toEqual([2]);
    expect(state.remaining).toBe(1);
    expect(state.completed).toBe(1);
  });
});

describe("SessionController — retry-safe submissions", () => {
  test("an ambiguous failure blocks progress; the retry reuses the same key", async () => {
    const api = new FakeApi();
    const storage = new MemoryOutboxStorage();
    api.batches.push({ items: [makeCard({ id: 1 })], summary: makeSummary(1), limit: 100 });
    api.reviews.push(new TypeError("network down"));

    const h = makeHarness(api, storage);
    await h.controller.start();
    await h.controller.rate(3);

    let state = h.controller.getState();
    expect(state.pendingRetry).not.toBeNull();
    const key = state.pendingRetry!.request_id;
    expect(api.reviewCalls.length).toBe(1);
    // Still staged for a later visit.
    expect((await storage.listForUser(7)).map((op) => op.request_id)).toEqual([key]);

    // Further ratings are blocked while unresolved.
    await h.controller.rate(3);
    expect(api.reviewCalls.length).toBe(1);

    api.reviews.push(ack(makeCard({ id: 1 }), 0, { requestId: key }));
    api.batches.push({ items: [], summary: makeSummary(0), limit: 100 });
    await h.controller.retryPending();

    state = h.controller.getState();
    expect(state.pendingRetry).toBeNull();
    expect(api.reviewCalls.length).toBe(2);
    expect(api.reviewCalls[1].payload.request_id).toBe(key);
    expect(await storage.listForUser(7)).toEqual([]);
    expect(state.phase).toBe("exhausted");
  });

  test("a replayed ack settles the outbox like a fresh record", async () => {
    const api = new FakeApi();
    const storage = new MemoryOutboxStorage();
    api.batches.push({ items: [makeCard({ id: 1 })], summary: makeSummary(1), limit: 100 });
    api.reviews.push(ack(makeCard({ id: 1 }), 0, { replayed: true }));

    const h = makeHarness(api, storage);
    await h.controller.start();
    await h.controller.rate(3);

    expect(h.controller.getState().completed).toBe(1);
    expect(await storage.listForUser(7)).toEqual([]);
  });

  test("a stale-version rejection drops the card and applies the fresh count", async () => {
    const api = new FakeApi();
    api.batches.push({
      items: [makeCard({ id: 1 }), makeCard({ id: 2 })],
      summary: makeSummary(2),
      limit: 100,
    });
    api.reviews.push(
      new ApiError("Card was reviewed elsewhere", 409, {
        code: "stale_review_version",
        summary: { ...makeSummary(1), as_of: "2026-09-29T12:00:00Z" },
      }),
    );

    const h = makeHarness(api);
    await h.controller.start();
    await h.controller.rate(3);

    const state = h.controller.getState();
    expect(state.queue.map((c) => c.id)).toEqual([2]);
    expect(state.remaining).toBe(1);
    expect(state.pendingRetry).toBeNull();
    expect(state.notice).toMatch(/already reviewed/i);
  });

  test("a deleted card (404) is dropped with a notice", async () => {
    const api = new FakeApi();
    api.batches.push({
      items: [makeCard({ id: 1 }), makeCard({ id: 2 })],
      summary: makeSummary(2),
      limit: 100,
    });
    api.reviews.push(new ApiError("Card not found", 404, "Card not found"));

    const h = makeHarness(api);
    await h.controller.start();
    await h.controller.rate(3);

    const state = h.controller.getState();
    expect(state.queue.map((c) => c.id)).toEqual([2]);
    expect(state.notice).toMatch(/no longer exists/i);
    expect(state.pendingRetry).toBeNull();
  });

  test("a double rating tap submits exactly one review", async () => {
    const api = new FakeApi();
    api.batches.push({
      items: [makeCard({ id: 1 }), makeCard({ id: 2 })],
      summary: makeSummary(2),
      limit: 100,
    });
    api.reviews.push(ack(makeCard({ id: 1, review_version: 1 }), 1));

    const h = makeHarness(api);
    await h.controller.start();
    const first = h.controller.rate(3);
    const second = h.controller.rate(3);
    await Promise.all([first, second]);

    expect(api.reviewCalls.length).toBe(1);
    expect(h.controller.getState().queue.map((c) => c.id)).toEqual([2]);
  });
});

describe("SessionController — settling earlier visits", () => {
  test("reviews staged by an earlier visit are settled before the first batch", async () => {
    const api = new FakeApi();
    const storage = new MemoryOutboxStorage();
    await storage.put(stagedOp());
    api.reviews.push(ack(makeCard({ id: 5 }), 0, { requestId: "old-1" }));
    api.batches.push({ items: [makeCard({ id: 1 })], summary: makeSummary(1), limit: 100 });

    const h = makeHarness(api, storage);
    await h.controller.start();

    expect(api.log).toEqual(["review", "batch"]);
    expect(api.reviewCalls[0].payload.request_id).toBe("old-1");
    expect(await storage.listForUser(7)).toEqual([]);
    expect(h.controller.getState().notice).toMatch(/Recovered 1 review/);
  });

  test("an unsettled staged review blocks rating with its original key", async () => {
    const api = new FakeApi();
    const storage = new MemoryOutboxStorage();
    await storage.put(stagedOp());
    api.reviews.push(new TypeError("offline"));
    api.batches.push({ items: [makeCard({ id: 1 })], summary: makeSummary(1), limit: 100 });

    const h = makeHarness(api, storage);
    await h.controller.start();

    const state = h.controller.getState();
    expect(state.pendingRetry?.request_id).toBe("old-1");
    expect((await storage.listForUser(7)).map((op) => op.request_id)).toEqual(["old-1"]);
  });

  test("ops staged for another scope never block this session", async () => {
    const api = new FakeApi();
    const storage = new MemoryOutboxStorage();
    await storage.put(stagedOp({ scope_deck_id: 9 }));
    api.reviews.push(new TypeError("offline"));
    api.batches.push({ items: [makeCard({ id: 1 })], summary: makeSummary(1), limit: 100 });

    const h = makeHarness(api, storage);
    await h.controller.start();

    const state = h.controller.getState();
    expect(state.pendingRetry).toBeNull();
    expect(state.notice).toMatch(/could not be confirmed/i);
  });
});

describe("SessionController — error handling and resume", () => {
  test("a failed durable write degrades the flag but never blocks the review", async () => {
    const api = new FakeApi();
    const broken: OutboxStorage = {
      listForUser: async () => {
        throw new Error("storage denied");
      },
      put: async () => {
        throw new Error("storage denied");
      },
      remove: async () => {
        throw new Error("storage denied");
      },
    };
    api.batches.push({ items: [makeCard({ id: 1 })], summary: makeSummary(1), limit: 100 });
    api.reviews.push(ack(makeCard({ id: 1 }), 0));
    api.batches.push({ items: [], summary: makeSummary(0), limit: 100 });

    const h = makeHarness(api, broken);
    await h.controller.start();
    await h.controller.rate(3);

    expect(h.controller.getState().durabilityDegraded).toBe(true);
    expect(api.reviewCalls.length).toBe(1);
    expect(h.controller.getState().phase).toBe("exhausted");
  });

  test("an inconsistent snapshot (empty batch, non-zero count) is retryable, not 'finished'", async () => {
    const api = new FakeApi();
    api.batches.push({ items: [], summary: makeSummary(5), limit: 100 });

    const h = makeHarness(api);
    await h.controller.start();

    expect(h.controller.getState().phase).toBe("error");
    expect(h.clearedSeeds()).toBe(0);
  });

  test("a failed first load is retryable and never clears the seed", async () => {
    const api = new FakeApi();
    api.batches.push(new Error("Failed to fetch due cards"));

    const h = makeHarness(api);
    await h.controller.start();

    expect(h.controller.getState().phase).toBe("error");
    expect(h.controller.getState().error).toMatch(/Failed to fetch/);
    expect(h.clearedSeeds()).toBe(0);
  });

  test("handleResume refreshes the authoritative count while cards remain", async () => {
    const api = new FakeApi();
    api.batches.push({ items: [makeCard({ id: 1 })], summary: makeSummary(3), limit: 100 });
    api.summaries.push(makeSummary(9));

    const h = makeHarness(api);
    await h.controller.start();
    expect(h.controller.getState().remaining).toBe(3);

    await h.controller.handleResume();

    expect(h.controller.getState().remaining).toBe(9);
  });

  test("handleResume settles a pending retry when the connection is back", async () => {
    const api = new FakeApi();
    api.batches.push({ items: [makeCard({ id: 1 })], summary: makeSummary(1), limit: 100 });
    api.reviews.push(new TypeError("offline"));

    const h = makeHarness(api);
    await h.controller.start();
    await h.controller.rate(3);
    const key = h.controller.getState().pendingRetry!.request_id;

    api.reviews.push(ack(makeCard({ id: 1 }), 0, { requestId: key }));
    api.batches.push({ items: [], summary: makeSummary(0), limit: 100 });
    await h.controller.handleResume();

    expect(h.controller.getState().pendingRetry).toBeNull();
    expect(h.controller.getState().phase).toBe("exhausted");
    expect(api.reviewCalls[1].payload.request_id).toBe(key);
  });
});

describe("generateRequestId", () => {
  test("returns unique ids", () => {
    const ids = new Set(Array.from({ length: 200 }, () => generateRequestId()));
    expect(ids.size).toBe(200);
  });
});

describe("SessionController — review-fix regressions", () => {
  test("overlapping retries submit once and apply once", async () => {
    const api = new FakeApi();
    api.batches.push({
      items: [makeCard({ id: 1 }), makeCard({ id: 2 }), makeCard({ id: 3 })],
      summary: makeSummary(3),
      limit: 100,
    });
    api.reviews.push(new TypeError("offline"));

    const h = makeHarness(api);
    await h.controller.start();
    await h.controller.rate(3);
    expect(h.controller.getState().pendingRetry).not.toBeNull();

    api.reviews.push(ack(makeCard({ id: 1, review_version: 1 }), 2));
    const first = h.controller.retryPending();
    const second = h.controller.retryPending();
    await Promise.all([first, second]);

    expect(api.reviewCalls.length).toBe(2);
    const state = h.controller.getState();
    expect(state.queue.map((c) => c.id)).toEqual([2, 3]);
    expect(state.completed).toBe(1);
    expect(state.remaining).toBe(2);
  });

  test("handleResume does not double-submit an in-flight retry", async () => {
    const api = new FakeApi();
    api.batches.push({
      items: [makeCard({ id: 1 }), makeCard({ id: 2 }), makeCard({ id: 3 })],
      summary: makeSummary(3),
      limit: 100,
    });
    api.reviews.push(new TypeError("offline"));

    const h = makeHarness(api);
    await h.controller.start();
    await h.controller.rate(3);

    api.reviews.push(ack(makeCard({ id: 1, review_version: 1 }), 2));
    const retrying = h.controller.retryPending();
    const resumed = h.controller.handleResume();
    await Promise.all([retrying, resumed]);

    expect(api.reviewCalls.length).toBe(2);
    expect(h.controller.getState().queue.map((c) => c.id)).toEqual([2, 3]);
    expect(h.controller.getState().completed).toBe(1);
  });

  test("a restored operation for a non-head card settles without reordering the queue", async () => {
    const api = new FakeApi();
    const storage = new MemoryOutboxStorage();
    await storage.put(stagedOp({ request_id: "old-5", card_id: 5, rating: 1 }));
    api.reviews.push(new TypeError("offline"));
    api.batches.push({
      items: [makeCard({ id: 1 }), makeCard({ id: 5 }), makeCard({ id: 2 })],
      summary: makeSummary(3),
      limit: 100,
    });

    const h = makeHarness(api, storage);
    await h.controller.start();
    expect(h.controller.getState().pendingRetry?.request_id).toBe("old-5");

    api.reviews.push(ack(makeCard({ id: 5, review_version: 1 }), 3, { requestId: "old-5" }));
    await h.controller.retryPending();

    const state = h.controller.getState();
    expect(state.queue.map((c) => c.id)).toEqual([1, 2]);
    expect(state.completed).toBe(0);
    expect(state.remaining).toBe(3);
    expect(state.pendingRetry).toBeNull();
  });

  test("refresh settles the blocked retry and unblocks ratings", async () => {
    const api = new FakeApi();
    const storage = new MemoryOutboxStorage();
    api.batches.push({
      items: [makeCard({ id: 1 }), makeCard({ id: 2 })],
      summary: makeSummary(2),
      limit: 100,
    });
    api.reviews.push(new TypeError("offline"));

    const h = makeHarness(api, storage);
    await h.controller.start();
    await h.controller.rate(3);
    const key = h.controller.getState().pendingRetry!.request_id;
    expect((await storage.listForUser(7)).length).toBe(1);

    // Refresh: reconciliation retries the staged op and settles it.
    api.reviews.push(ack(makeCard({ id: 1, review_version: 1 }), 2, { requestId: key }));
    api.batches.push({
      items: [makeCard({ id: 1, review_version: 1 }), makeCard({ id: 2 })],
      summary: makeSummary(2),
      limit: 100,
    });
    await h.controller.refresh();

    expect(h.controller.getState().pendingRetry).toBeNull();
    expect(api.reviewCalls.length).toBe(2);

    // Ratings work again with a fresh key.
    api.reviews.push(ack(makeCard({ id: 1, review_version: 2 }), 1));
    await h.controller.rate(3);
    api.reviews.push(ack(makeCard({ id: 2, review_version: 1 }), 0));
    api.batches.push({ items: [], summary: makeSummary(0), limit: 100 });
    await h.controller.rate(3);

    expect(api.reviewCalls.length).toBe(4);
    expect(h.controller.getState().phase).toBe("exhausted");
  });

  test("an empty scan releases a stale block (op settled elsewhere)", async () => {
    const api = new FakeApi();
    api.batches.push({ items: [makeCard({ id: 1 })], summary: makeSummary(1), limit: 100 });
    api.reviews.push(new TypeError("offline"));

    const h = makeHarness(api);
    await h.controller.start();
    await h.controller.rate(3);
    const key = h.controller.getState().pendingRetry!.request_id;

    // The op was completed elsewhere: it is no longer staged anywhere.
    await h.outbox.complete(key);
    api.batches.push({ items: [makeCard({ id: 1 })], summary: makeSummary(1), limit: 100 });
    await h.controller.refresh();

    expect(h.controller.getState().pendingRetry).toBeNull();
    expect(api.reviewCalls.length).toBe(1);
  });

  test("a slow resume summary never overwrites a newer count", async () => {
    const api = new FakeApi();
    api.batches.push({
      items: [makeCard({ id: 1 }), makeCard({ id: 2 })],
      summary: makeSummary(2),
      limit: 100,
    });

    const h = makeHarness(api);
    await h.controller.start();

    let release!: (summary: DueSummary) => void;
    api.summaries.push(
      new Promise<DueSummary>((resolve) => {
        release = resolve;
      }),
    );
    const resuming = h.controller.handleResume();

    // A review lands while the resume summary is still in flight.
    api.reviews.push(ack(makeCard({ id: 1, review_version: 1 }), 1));
    await h.controller.rate(3);
    expect(h.controller.getState().remaining).toBe(1);

    release(makeSummary(2));
    await resuming;

    expect(h.controller.getState().remaining).toBe(1);
  });

  test("a duplicate-in-flight 409 keeps the key staged for retry", async () => {
    const api = new FakeApi();
    const storage = new MemoryOutboxStorage();
    api.batches.push({ items: [makeCard({ id: 1 })], summary: makeSummary(1), limit: 100 });
    api.reviews.push(
      new ApiError("Duplicate submission is being processed", 409, {
        code: "duplicate_in_flight",
        message: "Duplicate submission is being processed; retry shortly.",
      }),
    );

    const h = makeHarness(api, storage);
    await h.controller.start();
    await h.controller.rate(3);

    const state = h.controller.getState();
    expect(state.pendingRetry).not.toBeNull();
    expect((await storage.listForUser(7)).length).toBe(1);
    expect(state.error).toBeNull();

    // A later retry replays with the same key and settles the session.
    const key = state.pendingRetry!.request_id;
    api.reviews.push(ack(makeCard({ id: 1, review_version: 1 }), 0, { requestId: key }));
    api.batches.push({ items: [], summary: makeSummary(0), limit: 100 });
    await h.controller.retryPending();

    expect(h.controller.getState().pendingRetry).toBeNull();
    expect(h.controller.getState().phase).toBe("exhausted");
  });

  test("rejections reset the review timer for the next card", async () => {
    const api = new FakeApi();
    let nowValue = 1_000;
    api.batches.push({
      items: [makeCard({ id: 1 }), makeCard({ id: 2 })],
      summary: makeSummary(2),
      limit: 100,
    });
    const h = makeHarness(api, undefined, { now: () => nowValue });
    await h.controller.start();

    let rejectRating!: (error: ApiError) => void;
    api.reviews.push(
      new Promise<ReviewAck>((_, reject) => {
        rejectRating = reject;
      }),
    );
    const rating = h.controller.rate(3);
    nowValue = 5_000;
    rejectRating(
      new ApiError("Card was reviewed elsewhere", 409, {
        code: "stale_review_version",
        message: "stale",
        summary: makeSummary(1),
      }),
    );
    await rating;
    expect(h.controller.getState().queue.map((c) => c.id)).toEqual([2]);

    nowValue = 6_000;
    api.reviews.push(ack(makeCard({ id: 2, review_version: 1 }), 0));
    api.batches.push({ items: [], summary: makeSummary(0), limit: 100 });
    await h.controller.rate(3);

    // 6_000 - 5_000 (reset on rejection), not 6_000 - 1_000 (card 1's show time).
    expect(api.reviewCalls[1].payload.review_duration_ms).toBe(1_000);
  });
});
