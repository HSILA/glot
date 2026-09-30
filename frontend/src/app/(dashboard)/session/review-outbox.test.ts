/**
 * ReviewOutbox tests.
 *
 * The outbox is what makes retries safe: the idempotency key is persisted
 * before the request is sent. These tests pin down the durable-write signal,
 * the merged (storage + memory) view, user filtering, and the graceful
 * degradation when storage is unavailable.
 */

import { describe, expect, test } from "bun:test";

import {
  createDefaultOutboxStorage,
  IndexedDbOutboxStorage,
  MemoryOutboxStorage,
  ReviewOutbox,
  type OutboxStorage,
  type PendingReview,
} from "./review-outbox";

function makeOp(overrides: Partial<PendingReview> = {}): PendingReview {
  return {
    request_id: "req-1",
    user_id: 7,
    card_id: 1,
    rating: 3,
    review_duration_ms: 1000,
    expected_review_version: 0,
    scope_deck_id: null,
    created_at: 1000,
    ...overrides,
  };
}

describe("MemoryOutboxStorage", () => {
  test("stores, lists by user, and removes by id", async () => {
    const storage = new MemoryOutboxStorage();
    await storage.put(makeOp({ request_id: "a", user_id: 7 }));
    await storage.put(makeOp({ request_id: "b", user_id: 8 }));

    expect((await storage.listForUser(7)).map((op) => op.request_id)).toEqual(["a"]);

    await storage.remove("a");

    expect(await storage.listForUser(7)).toEqual([]);
    expect((await storage.listForUser(8)).map((op) => op.request_id)).toEqual(["b"]);
  });
});

describe("ReviewOutbox", () => {
  test("stage persists durably and complete removes the entry", async () => {
    const storage = new MemoryOutboxStorage();
    const outbox = new ReviewOutbox(storage);

    const result = await outbox.stage(makeOp());
    expect(result.durable).toBe(true);
    expect((await outbox.pendingForUser(7)).length).toBe(1);

    await outbox.complete("req-1");

    expect((await outbox.pendingForUser(7)).length).toBe(0);
    expect(await storage.listForUser(7)).toEqual([]);
  });

  test("pendingForUser merges storage and the memory mirror, oldest first", async () => {
    const storage = new MemoryOutboxStorage();
    const outbox = new ReviewOutbox(storage);

    await outbox.stage(makeOp({ request_id: "late", created_at: 2000 }));
    await storage.put(makeOp({ request_id: "early", created_at: 1000 }));

    const pending = await outbox.pendingForUser(7);

    expect(pending.map((op) => op.request_id)).toEqual(["early", "late"]);
  });

  test("a failed durable write still keeps the op visible for this page", async () => {
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
    const outbox = new ReviewOutbox(broken);

    const result = await outbox.stage(makeOp());
    expect(result.durable).toBe(false);

    // The memory mirror keeps it retryable for this page's lifetime.
    expect((await outbox.pendingForUser(7)).map((op) => op.request_id)).toEqual(["req-1"]);

    await outbox.complete("req-1");
    expect(await outbox.pendingForUser(7)).toEqual([]);
  });

  test("filters other users' operations", async () => {
    const outbox = new ReviewOutbox(new MemoryOutboxStorage());
    await outbox.stage(makeOp({ request_id: "mine", user_id: 7 }));
    await outbox.stage(makeOp({ request_id: "theirs", user_id: 8 }));

    expect((await outbox.pendingForUser(7)).map((op) => op.request_id)).toEqual(["mine"]);
  });
});

describe("createDefaultOutboxStorage", () => {
  test("uses the memory store when IndexedDB is unavailable", () => {
    if (typeof indexedDB === "undefined") {
      expect(createDefaultOutboxStorage()).toBeInstanceOf(MemoryOutboxStorage);
    }
  });
});

describe("IndexedDbOutboxStorage", () => {
  test("a failing IndexedDB open surfaces through stage as non-durable", async () => {
    const failingFactory = {
      open: () => {
        throw new Error("IDB unavailable");
      },
    } as unknown as IDBFactory;
    const outbox = new ReviewOutbox(new IndexedDbOutboxStorage(failingFactory));

    const result = await outbox.stage(makeOp());

    expect(result.durable).toBe(false);
  });
});
