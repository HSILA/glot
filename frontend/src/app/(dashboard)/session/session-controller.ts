/**
 * Study-session controller.
 *
 * Owns the state machine behind the review page:
 *
 * - Loads batches of due cards and keeps fetching as the queue drains, so a
 *   session never shows "nothing to review" while due cards remain. Only a
 *   confirmed-empty scope (empty batch with a zero count from the same SQL
 *   snapshot) produces the finished state.
 * - Keeps the shown count truthful: the header shows the server's
 *   study-eligible count for the session's scope (the same computation the
 *   dashboard displays), refreshed from the summary returned with every
 *   acknowledged rating and every batch.
 * - Submits ratings through the durable outbox: the idempotency key is
 *   persisted before the request is sent; a retry reuses the same key and
 *   payload; an ambiguous failure (lost response, timeout, 5xx) blocks
 *   progress with an explicit retry instead of losing or double-recording
 *   the rating. Definitive rejections (stale version, deleted card) drop the
 *   card from the session with a notice.
 * - Reconciles pending work and refreshes counts when the user returns to
 *   the tab.
 *
 * The controller is DOM-free — storage, API, and clock are injected — so it
 * can be unit-tested without a browser environment.
 */

import type { Card, DueSummary } from "@/lib/api/cards";
import { ApiError } from "@/lib/api-error";
import { advanceQueue, shouldRequeue, type Rating } from "./session-queue";
import type { PendingReview, ReviewOutbox } from "./review-outbox";

export interface SessionScope {
  userId: number;
  /** Deck scope; undefined = mixed review. */
  deckId?: number;
}

export type SessionPhase =
  | "loading"
  | "active"
  | "submitting"
  | "loading_more"
  | "exhausted"
  | "error";

/** The ack data the controller needs from a review submission. */
export interface ReviewAck {
  card: Card;
  request_id: string | null;
  review_id: number | null;
  replayed: boolean;
  summary: DueSummary | null;
}

export interface SessionApi {
  getDueBatch(
    options: { deck_id?: number; limit?: number; seed?: number },
    init?: { signal?: AbortSignal },
  ): Promise<{ items: Card[]; summary: DueSummary; limit: number }>;
  getDueSummary(options?: { deck_id?: number }): Promise<DueSummary>;
  reviewCard(
    cardId: number,
    payload: {
      rating: Rating;
      review_duration_ms?: number;
      request_id: string;
      expected_review_version?: number;
      scope_deck_id?: number;
    },
    init?: { signal?: AbortSignal },
  ): Promise<ReviewAck>;
}

export interface SessionState {
  phase: SessionPhase;
  queue: Card[];
  /** Server-authoritative remaining count for the scope; null until known. */
  remaining: number | null;
  /** Distinct cards passed so far in this session. */
  completed: number;
  /**
   * An unresolved submission (ambiguous failure). While set, new ratings are
   * blocked; the user retries it (same idempotency key) or it self-resolves
   * on the next visit.
   */
  pendingRetry: PendingReview | null;
  /** Transient notice (recovered reviews, reconciled cards). */
  notice: string | null;
  /** Load/submission error text to surface. */
  error: string | null;
  /**
   * False once a durable outbox write has failed; retry protection then only
   * lasts for this page.
   */
  durabilityDegraded: boolean;
}

export interface SessionControllerOptions {
  scope: SessionScope;
  api: SessionApi;
  outbox: ReviewOutbox;
  /** Returns the persisted-or-fresh order seed for this scope. May not throw. */
  getSeed: () => number;
  /** Clears the stored seed (called only when the scope is confirmed empty). */
  clearSeed: () => void;
  onState: (state: SessionState) => void;
  now?: () => number;
  batchLimit?: number;
  /** Wrap sends so a hung request becomes a retryable failure; 0 disables. */
  submitTimeoutMs?: number;
}

type SendOutcome =
  | { kind: "acknowledged"; ack: ReviewAck }
  | { kind: "rejected"; reason: "stale" | "card_gone" | "invalid" | "other"; summary: DueSummary | null }
  | { kind: "ambiguous" };

const DEFAULT_BATCH_LIMIT = 100;
const DEFAULT_SUBMIT_TIMEOUT_MS = 20_000;

/** Idempotency key for one review submission. */
export function generateRequestId(): string {
  const cryptoObj = globalThis.crypto as Crypto | undefined;
  if (cryptoObj && typeof cryptoObj.randomUUID === "function") {
    return cryptoObj.randomUUID();
  }
  // Fallback for environments without randomUUID.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const rand = (Math.random() * 16) | 0;
    const value = char === "x" ? rand : (rand & 0x3) | 0x8;
    return value.toString(16);
  });
}

function isAbort(error: unknown): boolean {
  return (error as { name?: string } | null)?.name === "AbortError";
}

/** Best-effort parse of the summary carried in a stale-version 409 detail. */
function summaryFromConflict(detail: unknown): DueSummary | null {
  if (!detail || typeof detail !== "object") return null;
  const raw = (detail as { summary?: unknown }).summary;
  if (!raw || typeof raw !== "object") return null;
  const candidate = raw as Partial<DueSummary>;
  if (
    typeof candidate.scheduled_due_count !== "number" ||
    typeof candidate.new_count !== "number" ||
    typeof candidate.total !== "number"
  ) {
    return null;
  }
  return {
    scheduled_due_count: candidate.scheduled_due_count,
    new_count: candidate.new_count,
    total: candidate.total,
    as_of: typeof candidate.as_of === "string" ? candidate.as_of : "",
    deck_id: typeof candidate.deck_id === "number" ? candidate.deck_id : null,
  };
}

export class SessionController {
  private readonly scope: SessionScope;
  private readonly api: SessionApi;
  private readonly outbox: ReviewOutbox;
  private readonly getSeed: () => number;
  private readonly clearSeed: () => void;
  private readonly onState: (state: SessionState) => void;
  private readonly now: () => number;
  private readonly batchLimit: number;
  private readonly submitTimeoutMs: number;

  private state: SessionState = {
    phase: "loading",
    queue: [],
    remaining: null,
    completed: 0,
    pendingRetry: null,
    notice: null,
    error: null,
    durabilityDegraded: false,
  };

  private disposed = false;
  private loadGeneration = 0;
  private batchAbort: AbortController | null = null;
  private resolving = false;
  /** request_id of the submission currently in flight (one at a time). */
  private inFlight: string | null = null;
  /** Revision bumped whenever counts land from an authoritative source. */
  private countsVersion = 0;
  private startedAt: number;

  constructor(options: SessionControllerOptions) {
    this.scope = options.scope;
    this.api = options.api;
    this.outbox = options.outbox;
    this.getSeed = options.getSeed;
    this.clearSeed = options.clearSeed;
    this.onState = options.onState;
    this.now = options.now ?? (() => Date.now());
    this.batchLimit = options.batchLimit ?? DEFAULT_BATCH_LIMIT;
    this.submitTimeoutMs = options.submitTimeoutMs ?? DEFAULT_SUBMIT_TIMEOUT_MS;
    this.startedAt = this.now();
  }

  getState(): SessionState {
    return this.state;
  }

  dispose(): void {
    this.disposed = true;
    this.loadGeneration += 1;
    this.batchAbort?.abort();
    this.batchAbort = null;
  }

  private emit(): void {
    this.onState({ ...this.state, queue: [...this.state.queue] });
  }

  /** First entry point: reconcile pending work, then load the first batch. */
  async start(): Promise<void> {
    await this.resolvePending();
    await this.loadBatch(true);
  }

  /** Full reload (refresh button): reconcile pending work, reload counts. */
  async refresh(): Promise<void> {
    if (this.disposed) return;
    this.state.notice = null;
    await this.resolvePending();
    await this.loadBatch(true);
  }

  /**
   * Called when the tab becomes visible again. Attempts to settle pending
   * work and refreshes the authoritative count (or loads the next batch when
   * the scope may have new work) before the user can rate again.
   */
  async handleResume(): Promise<void> {
    if (this.disposed) return;
    if (this.state.pendingRetry) {
      await this.retryPending();
      // A settled retry already refreshed the queue and counts (or it failed
      // again and stays pending); nothing else to reconcile.
      return;
    }

    if (this.state.phase === "exhausted") {
      await this.loadBatch(false);
    } else if (this.state.phase === "active" && this.state.queue.length > 0) {
      try {
        // A summary read that a rating or batch update races past must not
        // overwrite the newer count: capture the revision and apply the
        // fetched value only when nothing newer has landed meanwhile.
        const version = this.countsVersion;
        const summary = await this.api.getDueSummary({ deck_id: this.scope.deckId });
        if (this.disposed) return;
        if (this.countsVersion !== version) return;
        this.setRemaining(summary.total);
        this.emit();
      } catch {
        // Offline or transient: keep the last known count.
      }
    }
  }

  /** Rate the head card. Blocked while a submission is unresolved. */
  async rate(rating: Rating): Promise<void> {
    if (this.disposed) return;
    if (this.state.pendingRetry || this.resolving) return;

    const card = this.state.queue[0];
    if (!card || this.state.phase !== "active") return;

    // Block further ratings immediately (double-tap guard): staging below is
    // async, and the phase check above would otherwise still pass meanwhile.
    this.state.phase = "submitting";
    this.state.error = null;
    this.emit();

    const op: PendingReview = {
      request_id: generateRequestId(),
      user_id: this.scope.userId,
      card_id: card.id,
      rating,
      review_duration_ms: Math.max(0, this.now() - this.startedAt),
      expected_review_version:
        typeof card.review_version === "number" ? card.review_version : null,
      scope_deck_id: this.scope.deckId ?? null,
      created_at: this.now(),
    };

    const { durable } = await this.outbox.stage(op);
    if (this.disposed) return;
    if (!durable) this.state.durabilityDegraded = true;

    this.inFlight = op.request_id;
    try {
      const outcome = await this.sendToServer(op);
      if (this.disposed) return;
      await this.applyOutcome(op, outcome);
    } finally {
      if (this.inFlight === op.request_id) this.inFlight = null;
    }
  }

  /** Retry the unresolved submission with the SAME idempotency key. */
  async retryPending(): Promise<void> {
    const op = this.state.pendingRetry;
    if (this.disposed || !op) return;
    // One submission at a time per operation: an overlapping retry (button
    // plus resume, double click) must not apply the same acknowledgment
    // twice.
    if (this.resolving || this.inFlight === op.request_id) return;

    this.state.phase = "submitting";
    this.emit();

    this.inFlight = op.request_id;
    try {
      const outcome = await this.sendToServer(op);
      if (this.disposed) return;
      await this.applyOutcome(op, outcome);
    } finally {
      if (this.inFlight === op.request_id) this.inFlight = null;
    }
  }

  // --- internals -----------------------------------------------------------

  private opInScope(op: PendingReview): boolean {
    return (op.scope_deck_id ?? null) === (this.scope.deckId ?? null);
  }

  private async withTimeout<T>(promise: Promise<T>, abort?: AbortController): Promise<T> {
    if (!this.submitTimeoutMs) return promise;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(
        () => {
          // Cancel the request too: a retry must not race a still-open
          // duplicate over the wire.
          abort?.abort();
          reject(new Error("Review submission timed out"));
        },
        this.submitTimeoutMs,
      );
      promise.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error) => {
          clearTimeout(timer);
          reject(error);
        },
      );
    });
  }

  private async sendToServer(op: PendingReview): Promise<SendOutcome> {
    const payload: Parameters<SessionApi["reviewCard"]>[1] = {
      rating: op.rating,
      review_duration_ms: op.review_duration_ms,
      request_id: op.request_id,
    };
    if (op.expected_review_version !== null) {
      payload.expected_review_version = op.expected_review_version;
    }
    if (op.scope_deck_id !== null) {
      payload.scope_deck_id = op.scope_deck_id;
    }

    const abort = new AbortController();
    try {
      const ack = await this.withTimeout(
        this.api.reviewCard(op.card_id, payload, { signal: abort.signal }),
        abort,
      );
      return { kind: "acknowledged", ack };
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.status === 409) {
          const code =
            error.detail && typeof error.detail === "object"
              ? ((error.detail as { code?: unknown }).code ?? null)
              : null;
          if (code === "duplicate_in_flight") {
            // The server still has this exact key in flight: nothing was
            // recorded yet, and the retry must keep the original key.
            return { kind: "ambiguous" };
          }
          if (code === "stale_review_version") {
            return {
              kind: "rejected",
              reason: "stale",
              summary: summaryFromConflict(error.detail),
            };
          }
          return { kind: "rejected", reason: "other", summary: null };
        }
        if (error.status === 404) {
          return { kind: "rejected", reason: "card_gone", summary: null };
        }
        if (error.status >= 400 && error.status < 500) {
          return { kind: "rejected", reason: "invalid", summary: null };
        }
        // 5xx: the review may or may not have been recorded — retryable.
        return { kind: "ambiguous" };
      }
      // Network failure, timeout, anything else: retryable.
      return { kind: "ambiguous" };
    }
  }

  private setRemaining(total: number): void {
    this.state.remaining = Math.max(0, total);
    // A newer count invalidates any summary read that is still in flight.
    this.countsVersion += 1;
  }

  private async applyOutcome(op: PendingReview, outcome: SendOutcome): Promise<void> {
    if (outcome.kind === "acknowledged") {
      await this.outbox.complete(op.request_id);
      if (this.disposed) return;

      const ack = outcome.ack;
      const head = this.state.queue[0];
      if (head !== undefined && head.id === op.card_id) {
        // Requeued cuts (Again) carry the UPDATED card object so a later
        // re-rating uses fresh scheduling fields and the new review_version.
        this.state.queue = advanceQueue(this.state.queue, op.rating, undefined, ack.card);
        if (!shouldRequeue(op.rating)) this.state.completed += 1;
      } else if (head !== undefined) {
        // A restored operation for a card that is not the current head (an
        // earlier visit staged it). Settle it without reordering the session:
        // drop the reviewed card from the loaded queue. If the rating keeps
        // it due, the next batch brings it back with a fresh version.
        this.state.queue = this.state.queue.filter((card) => card.id !== op.card_id);
      }

      if (ack.summary) {
        this.setRemaining(ack.summary.total);
      } else if (this.state.remaining !== null) {
        // Legacy server fallback: a passing rating removes the card from the
        // due set; Again keeps it due.
        if (!shouldRequeue(op.rating)) {
          this.state.remaining = Math.max(0, this.state.remaining - 1);
        }
      }

      this.startedAt = this.now();
      this.state.pendingRetry = null;

      if (this.state.queue.length === 0) {
        // The loaded batch is done; continue with the next batch. Only a
        // confirmed-empty scope may end the session.
        await this.loadBatch(false);
      } else {
        this.state.phase = "active";
        this.emit();
      }
      return;
    }

    if (outcome.kind === "rejected") {
      // Definitive: the server did not record this submission.
      await this.outbox.complete(op.request_id);
      if (this.disposed) return;
      this.state.pendingRetry = null;

      if (outcome.reason === "stale") {
        // Another device — or an earlier visit of this session — already
        // reviewed the card. Applying this rating would overwrite newer
        // scheduling, so the server refused it; drop the card from this
        // session and use the fresh counts it returned.
        this.state.notice =
          "This card was already reviewed elsewhere, so it was removed from this session.";
        if (outcome.summary) this.setRemaining(outcome.summary.total);
        this.state.queue = this.state.queue.filter((card) => card.id !== op.card_id);
        // The next card's review timer starts now, not when this one was shown.
        this.startedAt = this.now();
        if (this.state.queue.length === 0) {
          await this.loadBatch(false);
        } else {
          this.state.phase = "active";
          this.emit();
        }
        return;
      }

      if (outcome.reason === "card_gone") {
        this.state.notice = "This card no longer exists, so it was removed from the session.";
        this.state.queue = this.state.queue.filter((card) => card.id !== op.card_id);
        this.startedAt = this.now();
        if (this.state.queue.length === 0) {
          await this.loadBatch(false);
        } else {
          this.state.phase = "active";
          this.emit();
        }
        return;
      }

      // Other definitive rejections (validation, key misuse): nothing was
      // recorded. Keep the card and let the user rate it again (a new key).
      this.state.phase = "active";
      this.state.error = "The server rejected that rating. Please rate the card again.";
      this.emit();
      return;
    }

    // Ambiguous: keep the operation staged and block progress until the user
    // (or the next visit) settles it. The same key makes the retry safe.
    this.state.pendingRetry = op;
    this.state.phase = "active";
    this.emit();
  }

  /**
   * Settle operations staged by earlier visits (page reload after a lost
   * response, another tab, a previous session). Runs BEFORE the first batch
   * so counts already include the recovered reviews.
   */
  private async resolvePending(): Promise<void> {
    if (this.resolving || this.disposed || this.inFlight) return;
    this.resolving = true;
    try {
      const pending = await this.outbox.pendingForUser(this.scope.userId);
      if (this.disposed) return;

      const settledIds = new Set<string>();
      let unresolved = 0;
      let unresolvedInScope: PendingReview | null = null;

      for (const op of pending) {
        const outcome = await this.sendToServer(op);
        if (this.disposed) return;
        if (outcome.kind === "ambiguous") {
          unresolved += 1;
          if (this.opInScope(op) && !unresolvedInScope) unresolvedInScope = op;
        } else {
          await this.outbox.complete(op.request_id);
          settledIds.add(op.request_id);
        }
      }

      if (settledIds.size > 0) {
        this.state.notice = `Recovered ${settledIds.size} review${settledIds.size === 1 ? "" : "s"} from an earlier visit.`;
      }
      if (unresolvedInScope) {
        this.state.pendingRetry = unresolvedInScope;
      } else if (this.state.pendingRetry) {
        // The blocking retry settled (just now, on another surface, or the
        // scan no longer contains it); ratings are unblocked again.
        this.state.pendingRetry = null;
      }
      if (!unresolvedInScope && unresolved > 0) {
        const tail = `${unresolved} earlier review${unresolved === 1 ? "" : "s"} could not be confirmed yet; it will retry automatically.`;
        this.state.notice = this.state.notice ? `${this.state.notice} ${tail}` : tail;
      }
      this.emit();
    } finally {
      this.resolving = false;
    }
  }

  private async loadBatch(first: boolean): Promise<void> {
    if (this.disposed) return;

    this.loadGeneration += 1;
    const generation = this.loadGeneration;
    this.batchAbort?.abort();
    const abort = new AbortController();
    this.batchAbort = abort;

    this.state.phase = first ? "loading" : "loading_more";
    this.state.error = null;
    if (first) {
      this.state.queue = [];
      this.state.completed = 0;
      this.state.remaining = null;
    }
    this.emit();

    let batch: { items: Card[]; summary: DueSummary; limit: number };
    try {
      batch = await this.api.getDueBatch(
        { deck_id: this.scope.deckId, limit: this.batchLimit, seed: this.getSeed() },
        { signal: abort.signal },
      );
    } catch (error) {
      if (this.disposed || generation !== this.loadGeneration) return;
      if (isAbort(error)) return;
      this.state.phase = "error";
      this.state.error =
        error instanceof Error ? error.message : "Failed to load review session";
      this.emit();
      return;
    }

    if (this.disposed || generation !== this.loadGeneration) return;

    this.state.queue = first ? batch.items : [...this.state.queue, ...batch.items];
    if (first) this.startedAt = this.now();
    this.setRemaining(batch.summary.total);

    if (batch.items.length === 0 && batch.summary.total === 0) {
      // Confirmed empty: the only truthful "all caught up".
      this.clearSeedSafe();
      this.state.phase = "exhausted";
    } else if (batch.items.length === 0) {
      // Items and counts share one SQL snapshot, so this should be
      // impossible; treat it as a retryable inconsistency rather than
      // claiming the session is done.
      this.state.phase = "error";
      this.state.error = "Could not load the next cards just now.";
    } else {
      this.state.phase = "active";
    }
    this.emit();
  }

  private clearSeedSafe(): void {
    try {
      this.clearSeed();
    } catch {
      // Storage unavailable; nothing to clear.
    }
  }
}
