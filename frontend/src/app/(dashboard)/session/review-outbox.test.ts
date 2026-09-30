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

/** Minimal fake IndexedDB good enough for the storage adapter. */
interface FakeRequestLike {
  onsuccess: (() => void) | null;
  onerror: (() => void) | null;
  onupgradeneeded: (() => void) | null;
  result?: unknown;
}

interface FakeTransactionLike {
  oncomplete: (() => void) | null;
  onabort: (() => void) | null;
  onerror: (() => void) | null;
  error: Error | null;
  objectStore: () => {
    put: () => FakeRequestLike;
    delete: () => FakeRequestLike;
    index: () => { getAll: () => FakeRequestLike };
  };
}

function makeFakeIndexedDb() {
  let currentRequest: FakeRequestLike | null = null;
  let currentTransaction: FakeTransactionLike | null = null;

  const makeRequest = (): FakeRequestLike => {
    currentRequest = { onsuccess: null, onerror: null, onupgradeneeded: null };
    return currentRequest;
  };

  const db = {
    objectStoreNames: { contains: () => true },
    transaction: () => {
      const transaction: FakeTransactionLike = {
        oncomplete: null,
        onabort: null,
        onerror: null,
        error: null,
        objectStore: () => ({
          put: makeRequest,
          delete: makeRequest,
          index: () => ({ getAll: makeRequest }),
        }),
      };
      currentTransaction = transaction;
      return transaction;
    },
  };

  const factory = {
    open: () => {
      const request: FakeRequestLike = {
        onsuccess: null,
        onerror: null,
        onupgradeneeded: null,
      };
      queueMicrotask(() => {
        request.result = db;
        request.onsuccess?.();
      });
      return request;
    },
  };

  return {
    factory: factory as unknown as IDBFactory,
    succeedRequest(result?: unknown) {
      if (!currentRequest) throw new Error("no request created yet");
      currentRequest.result = result;
      currentRequest.onsuccess?.();
    },
    completeTransaction() {
      if (!currentTransaction) throw new Error("no transaction created yet");
      currentTransaction.oncomplete?.();
    },
    abortTransaction(error?: Error) {
      if (!currentTransaction) throw new Error("no transaction created yet");
      currentTransaction.error = error ?? null;
      currentTransaction.onabort?.();
    },
  };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("IndexedDbOutboxStorage — transaction commit semantics", () => {
  test("a write resolves only after the transaction commits", async () => {
    const idb = makeFakeIndexedDb();
    const storage = new IndexedDbOutboxStorage(idb.factory);

    let settled = false;
    const pending = storage.put(makeOp()).then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    await tick();

    // The request succeeded but the transaction has not committed yet.
    idb.succeedRequest();
    await tick();
    expect(settled).toBe(false);

    idb.completeTransaction();
    await pending;
    expect(settled).toBe(true);
  });

  test("a transaction abort makes the stage report non-durable", async () => {
    const idb = makeFakeIndexedDb();
    const outbox = new ReviewOutbox(new IndexedDbOutboxStorage(idb.factory));

    const staged = outbox.stage(makeOp());
    await tick();
    idb.succeedRequest();
    idb.abortTransaction(new Error("quota exceeded"));

    const result = await staged;
    expect(result.durable).toBe(false);
  });
});
