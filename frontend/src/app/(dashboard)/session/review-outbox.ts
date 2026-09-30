/**
 * Durable outbox for review submissions.
 *
 * A review never goes to the network until its idempotency key (and the
 * frozen payload) is persisted locally first. That ordering is what makes
 * retries safe: if the response is lost — flaky connection, app killed
 * mid-request — the staged operation can be re-sent later with the same
 * `request_id`, and the server answers from the recorded receipt instead of
 * applying the rating twice.
 *
 * Storage is pluggable and always guarded: IndexedDB is used in the browser,
 * an in-memory fallback covers private-browsing modes and tests. When a
 * durable write fails, `stage` reports `{ durable: false }` so the caller can
 * degrade honestly (retry still works for this page, but not after a reload).
 *
 * A memory mirror keeps every staged operation visible for the page's
 * lifetime even when the durable write failed.
 */

export type OutboxRating = 1 | 2 | 3 | 4;

export interface PendingReview {
  /** Client-generated idempotency key; stable across retries of one intent. */
  request_id: string;
  user_id: number;
  card_id: number;
  rating: OutboxRating;
  /** Frozen with the payload: retries must present identical values. */
  review_duration_ms: number;
  expected_review_version: number | null;
  /** Session scope at staging time (null = mixed review). */
  scope_deck_id: number | null;
  created_at: number;
}

export interface OutboxStorage {
  listForUser(userId: number): Promise<PendingReview[]>;
  put(op: PendingReview): Promise<void>;
  remove(requestId: string): Promise<void>;
}

/** In-memory storage. Used in tests and as the last-resort fallback. */
export class MemoryOutboxStorage implements OutboxStorage {
  private readonly items = new Map<string, PendingReview>();

  async listForUser(userId: number): Promise<PendingReview[]> {
    return [...this.items.values()].filter((op) => op.user_id === userId);
  }

  async put(op: PendingReview): Promise<void> {
    this.items.set(op.request_id, op);
  }

  async remove(requestId: string): Promise<void> {
    this.items.delete(requestId);
  }
}

const DB_NAME = "glot-review-outbox";
const DB_VERSION = 1;
const STORE = "reviews";
const USER_INDEX = "by_user";

/**
 * IndexedDB-backed storage. Every method rejects on failure; the outbox
 * translates that into the non-durable (degraded) signal.
 */
export class IndexedDbOutboxStorage implements OutboxStorage {
  private dbPromise: Promise<IDBDatabase> | null = null;

  constructor(private readonly factory: IDBFactory) {}

  private open(): Promise<IDBDatabase> {
    if (!this.dbPromise) {
      const promise = new Promise<IDBDatabase>((resolve, reject) => {
        const request = this.factory.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(STORE)) {
            const store = db.createObjectStore(STORE, { keyPath: "request_id" });
            store.createIndex(USER_INDEX, "user_id", { unique: false });
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
      });
      this.dbPromise = promise.catch((error) => {
        // Allow a later attempt to reopen (e.g. after the user grants storage).
        this.dbPromise = null;
        throw error;
      });
    }
    return this.dbPromise;
  }

  private async run<T>(
    mode: IDBTransactionMode,
    makeRequest: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    const db = await this.open();
    return new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(STORE, mode);
      let result: T | undefined;

      const request = makeRequest(transaction.objectStore(STORE));
      request.onsuccess = () => {
        result = request.result;
      };
      request.onerror = () => {
        reject(request.error ?? new Error("IndexedDB request failed"));
      };
      // Resolve only when the transaction COMMITS: a write that has not
      // committed can still abort, and a lost idempotency key must never
      // look durable.
      transaction.oncomplete = () => resolve(result as T);
      transaction.onabort = () => {
        reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
      };
      transaction.onerror = () => {
        reject(transaction.error ?? new Error("IndexedDB transaction failed"));
      };
    });
  }

  async listForUser(userId: number): Promise<PendingReview[]> {
    return this.run("readonly", (store) => store.index(USER_INDEX).getAll(userId));
  }

  async put(op: PendingReview): Promise<void> {
    await this.run("readwrite", (store) => store.put(op));
  }

  async remove(requestId: string): Promise<void> {
    await this.run("readwrite", (store) => store.delete(requestId));
  }
}

/** Pick IndexedDB when available; otherwise a memory store. */
export function createDefaultOutboxStorage(): OutboxStorage {
  if (typeof indexedDB !== "undefined") {
    return new IndexedDbOutboxStorage(indexedDB);
  }
  return new MemoryOutboxStorage();
}

export class ReviewOutbox {
  /** Every staged op, kept for this page's lifetime regardless of storage. */
  private readonly mirror = new Map<string, PendingReview>();

  constructor(private readonly storage: OutboxStorage) {}

  /**
   * Persist an operation before it is sent. Returns whether the write is
   * durable (survives a reload); `false` means retry protection is limited
   * to this page.
   */
  async stage(op: PendingReview): Promise<{ durable: boolean }> {
    this.mirror.set(op.request_id, op);
    try {
      await this.storage.put(op);
      return { durable: true };
    } catch {
      return { durable: false };
    }
  }

  /** Remove an operation after a definitive outcome. */
  async complete(requestId: string): Promise<void> {
    this.mirror.delete(requestId);
    try {
      await this.storage.remove(requestId);
    } catch {
      // A leftover entry only costs one replayed request on a later visit;
      // the server's receipt makes that harmless.
    }
  }

  /**
   * All staged operations for a user, oldest first, merging durable storage
   * with the in-memory mirror.
   */
  async pendingForUser(userId: number): Promise<PendingReview[]> {
    let stored: PendingReview[] = [];
    try {
      stored = await this.storage.listForUser(userId);
    } catch {
      // Fall through to the mirror.
    }

    const merged = new Map<string, PendingReview>();
    for (const op of stored) merged.set(op.request_id, op);
    for (const op of this.mirror.values()) {
      if (op.user_id === userId) merged.set(op.request_id, op);
    }

    return [...merged.values()].sort((a, b) => a.created_at - b.created_at);
  }
}
