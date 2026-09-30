import { apiErrorFromResponse } from "@/lib/api-error";
import { fetchWithAuth } from "@/lib/api/fetch-with-auth";

export type CardState = "new" | "learning" | "review" | "relearning";

export interface Card {
  id: number;
  sequence: number;
  front_content: string;
  back_content: string;
  meta_data: Record<string, unknown>;
  tags: string[];
  deck_id: number | null;
  difficulty: number;
  stability: number;
  state: CardState;
  reps: number;
  lapses: number;
  /**
   * Bumped by the server on every recorded review. The session echoes the
   * version it saw back on each rating so a stale submission (card reviewed
   * on another device meanwhile) is rejected instead of overwriting newer
   * scheduling.
   */
  review_version: number;
  last_review_at: string | null;
  next_review_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ListCardsOptions {
  state?: CardState;
  deck_id?: number;
  tag?: string;
  limit?: number;
  offset?: number;
}

export interface CardListResponse {
  items: Card[];
  total: number;
  limit: number;
  offset: number;
}

export interface DueCardsOptions {
  deck_id?: number;
  limit?: number;
  /**
   * Optional RNG seed for a stable presentation order across requests. With the
   * same due-card set, the same seed yields the same order, so an interrupted
   * study session (reload, tab close) resumes in the same order. Omit to let the
   * backend randomise the order on every request.
   */
  seed?: number;
}

/**
 * Study-eligible counts for one scope (all decks, or a single deck).
 *
 * `total` is the number the session header shows and the dashboard's
 * "cards to study" figure; the breakdown is the dashboard's "due" and "new"
 * chips. Both surfaces read the same server computation, so they cannot
 * disagree.
 */
export interface DueSummary {
  scheduled_due_count: number;
  new_count: number;
  total: number;
  as_of: string;
  deck_id: number | null;
}

/**
 * One batch of the study queue plus the scope counts from the same SQL
 * snapshot. An empty `items` with `summary.total === 0` is the only truthful
 * "nothing left to review" signal.
 */
export interface DueBatchResponse {
  items: Card[];
  summary: DueSummary;
  limit: number;
}

export interface CreateCardRequest {
  front_content: string;
  back_content: string;
  meta_data?: Record<string, unknown>;
  tags?: string[];
  deck_id: number;
}

export interface UpdateCardRequest {
  front_content?: string;
  back_content?: string;
  meta_data?: Record<string, unknown>;
  tags?: string[];
  /**
   * Omit deck_id to keep the current deck unchanged.
   * Provide a numeric deck_id to move the card.
   */
  deck_id?: number;
}

export interface ReviewRequest {
  rating: 1 | 2 | 3 | 4;
  review_duration_ms?: number;
  /**
   * Client-generated idempotency key. Retries of the same submission reuse
   * the same key; the server answers repeats from the recorded receipt
   * instead of applying the rating twice (`replayed: true`).
   */
  request_id: string;
  /**
   * The card's review_version when it was loaded. A mismatch means another
   * device reviewed the card first: the server answers 409 instead of
   * overwriting newer scheduling.
   */
  expected_review_version?: number;
  /**
   * Deck scope for the returned due summary (the session's scope). Omit for
   * all-decks (mixed) sessions.
   */
  scope_deck_id?: number;
}

export interface SchedulingInfo {
  interval_days: number;
  new_difficulty: number;
  new_stability: number;
}

export interface NextStatesResponse {
  again: SchedulingInfo;
  hard: SchedulingInfo;
  good: SchedulingInfo;
  easy: SchedulingInfo;
}

export interface ReviewResponse {
  card: Card;
  next_states: NextStatesResponse;
  message: string;
  request_id: string | null;
  review_id: number | null;
  /** True when this response replayed an earlier recorded submission. */
  replayed: boolean;
  /** Fresh scope counts (absent only on legacy submissions without a key). */
  summary: DueSummary | null;
}

/** Optional per-request controls for cancellable calls. */
export interface RequestOptions {
  signal?: AbortSignal;
}

const API_BASE = "/api/v1/cards";

const CARD_STATES: CardState[] = ["new", "learning", "review", "relearning"];

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function assertCard(value: unknown, context = "Card"): asserts value is Card {
  if (!isObject(value)) throw new Error(`${context}: expected object`);
  if (typeof value.id !== "number") throw new Error(`${context}: invalid id`);
  if (typeof value.sequence !== "number") throw new Error(`${context}: invalid sequence`);
  if (typeof value.front_content !== "string") throw new Error(`${context}: invalid front_content`);
  if (typeof value.back_content !== "string") throw new Error(`${context}: invalid back_content`);
  if (!isObject(value.meta_data)) throw new Error(`${context}: invalid meta_data`);
  if (!Array.isArray(value.tags) || value.tags.some((tag) => typeof tag !== "string")) {
    throw new Error(`${context}: invalid tags`);
  }
  if (!(value.deck_id === null || typeof value.deck_id === "number")) {
    throw new Error(`${context}: invalid deck_id`);
  }
  if (typeof value.difficulty !== "number") throw new Error(`${context}: invalid difficulty`);
  if (typeof value.stability !== "number") throw new Error(`${context}: invalid stability`);
  if (typeof value.state !== "string" || !CARD_STATES.includes(value.state as CardState)) {
    throw new Error(`${context}: invalid state`);
  }
  if (typeof value.reps !== "number") throw new Error(`${context}: invalid reps`);
  if (typeof value.lapses !== "number") throw new Error(`${context}: invalid lapses`);
  if (typeof value.review_version !== "number") {
    throw new Error(`${context}: invalid review_version`);
  }
  if (!(value.last_review_at === null || typeof value.last_review_at === "string")) {
    throw new Error(`${context}: invalid last_review_at`);
  }
  if (!(value.next_review_at === null || typeof value.next_review_at === "string")) {
    throw new Error(`${context}: invalid next_review_at`);
  }
  if (typeof value.created_at !== "string") throw new Error(`${context}: invalid created_at`);
  if (typeof value.updated_at !== "string") throw new Error(`${context}: invalid updated_at`);
}

function parseCard(value: unknown, context = "Card"): Card {
  assertCard(value, context);
  return value;
}

function parseCardArray(value: unknown, context = "Cards"): Card[] {
  if (!Array.isArray(value)) throw new Error(`${context}: expected array`);
  return value.map((item, index) => parseCard(item, `${context}[${index}]`));
}

function parseCardListResponse(value: unknown, context = "Card list response"): CardListResponse {
  if (!isObject(value)) throw new Error(`${context}: expected object`);
  const items = parseCardArray(value.items, `${context}.items`);
  if (typeof value.total !== "number") throw new Error(`${context}: invalid total`);
  if (typeof value.limit !== "number") throw new Error(`${context}: invalid limit`);
  if (typeof value.offset !== "number") throw new Error(`${context}: invalid offset`);

  return {
    items,
    total: value.total,
    limit: value.limit,
    offset: value.offset,
  };
}

function parseDueSummary(value: unknown, context = "Due summary"): DueSummary {
  if (!isObject(value)) throw new Error(`${context}: expected object`);
  if (typeof value.scheduled_due_count !== "number") {
    throw new Error(`${context}: invalid scheduled_due_count`);
  }
  if (typeof value.new_count !== "number") throw new Error(`${context}: invalid new_count`);
  if (typeof value.total !== "number") throw new Error(`${context}: invalid total`);
  if (value.scheduled_due_count + value.new_count !== value.total) {
    throw new Error(`${context}: total does not match the breakdown`);
  }
  if (typeof value.as_of !== "string") throw new Error(`${context}: invalid as_of`);
  if (!(value.deck_id === null || typeof value.deck_id === "number")) {
    throw new Error(`${context}: invalid deck_id`);
  }

  return {
    scheduled_due_count: value.scheduled_due_count,
    new_count: value.new_count,
    total: value.total,
    as_of: value.as_of,
    deck_id: value.deck_id,
  };
}

function parseDueBatchResponse(value: unknown): DueBatchResponse {
  if (!isObject(value)) throw new Error("Due batch response: expected object");
  const items = parseCardArray(value.items, "Due batch response.items");
  const summary = parseDueSummary(value.summary, "Due batch response.summary");
  if (typeof value.limit !== "number") throw new Error("Due batch response: invalid limit");

  return { items, summary, limit: value.limit };
}

function assertSchedulingInfo(value: unknown, context: string): asserts value is SchedulingInfo {
  if (!isObject(value)) throw new Error(`${context}: expected object`);
  if (typeof value.interval_days !== "number") throw new Error(`${context}: invalid interval_days`);
  if (typeof value.new_difficulty !== "number") throw new Error(`${context}: invalid new_difficulty`);
  if (typeof value.new_stability !== "number") throw new Error(`${context}: invalid new_stability`);
}

function parseNextStatesResponse(value: unknown): NextStatesResponse {
  if (!isObject(value)) throw new Error("Next states: expected object");
  assertSchedulingInfo(value.again, "Next states.again");
  assertSchedulingInfo(value.hard, "Next states.hard");
  assertSchedulingInfo(value.good, "Next states.good");
  assertSchedulingInfo(value.easy, "Next states.easy");
  return value as unknown as NextStatesResponse;
}

function parseReviewResponse(value: unknown): ReviewResponse {
  if (!isObject(value)) throw new Error("Review response: expected object");
  const card = parseCard(value.card, "Review response.card");
  const nextStates = parseNextStatesResponse(value.next_states);
  if (typeof value.message !== "string") throw new Error("Review response: invalid message");
  if (!(value.request_id === null || typeof value.request_id === "string")) {
    throw new Error("Review response: invalid request_id");
  }
  if (!(value.review_id === null || typeof value.review_id === "number")) {
    throw new Error("Review response: invalid review_id");
  }
  if (typeof value.replayed !== "boolean") {
    throw new Error("Review response: invalid replayed");
  }
  const summary =
    value.summary === null ? null : parseDueSummary(value.summary, "Review response.summary");

  return {
    card,
    next_states: nextStates,
    message: value.message,
    request_id: value.request_id,
    review_id: value.review_id,
    replayed: value.replayed,
    summary,
  };
}

class CardsApi {
  private async parseError(response: Response, fallback: string): Promise<never> {
    throw await apiErrorFromResponse(response, fallback);
  }

  async listCards(options: ListCardsOptions = {}): Promise<CardListResponse> {
    const params = new URLSearchParams();

    if (options.state) {
      params.set("state", options.state);
    }
    if (options.deck_id !== undefined) {
      params.set("deck_id", String(options.deck_id));
    }
    if (options.tag) {
      params.set("tag", options.tag);
    }
    params.set("limit", String(options.limit ?? 100));
    params.set("offset", String(options.offset ?? 0));

    const query = params.toString();
    const response = await fetchWithAuth(`${API_BASE}${query ? `?${query}` : ""}`, {
      credentials: "include",
    });

    if (!response.ok) {
      await this.parseError(response, "Failed to fetch cards");
    }

    const data = await response.json();
    return parseCardListResponse(data, "List cards response");
  }

  async getDueCards(options: DueCardsOptions = {}, init: RequestOptions = {}): Promise<Card[]> {
    const params = new URLSearchParams();

    if (options.deck_id !== undefined) {
      params.set("deck_id", String(options.deck_id));
    }
    params.set("limit", String(options.limit ?? 20));
    // Send 0 too: it is a valid seed, so guard on `undefined`, not falsiness.
    if (options.seed !== undefined) {
      params.set("seed", String(options.seed));
    }

    const query = params.toString();
    const response = await fetchWithAuth(`${API_BASE}/due${query ? `?${query}` : ""}`, {
      credentials: "include",
      cache: "no-store",
      signal: init.signal,
    });

    if (!response.ok) {
      await this.parseError(response, "Failed to fetch due cards");
    }

    const data = await response.json();
    return parseCardArray(data, "Due cards response");
  }

  /** Authoritative study-eligible counts for one scope. */
  async getDueSummary(
    options: { deck_id?: number } = {},
    init: RequestOptions = {},
  ): Promise<DueSummary> {
    const params = new URLSearchParams();
    if (options.deck_id !== undefined) {
      params.set("deck_id", String(options.deck_id));
    }

    const query = params.toString();
    const response = await fetchWithAuth(`${API_BASE}/due/summary${query ? `?${query}` : ""}`, {
      credentials: "include",
      cache: "no-store",
      signal: init.signal,
    });

    if (!response.ok) {
      await this.parseError(response, "Failed to fetch study counts");
    }

    const data = await response.json();
    return parseDueSummary(data);
  }

  /**
   * The next batch of the study queue plus the counts from the same snapshot.
   * The client keeps requesting batches until `items` is empty.
   */
  async getDueBatch(
    options: DueCardsOptions = {},
    init: RequestOptions = {},
  ): Promise<DueBatchResponse> {
    const params = new URLSearchParams();

    if (options.deck_id !== undefined) {
      params.set("deck_id", String(options.deck_id));
    }
    params.set("limit", String(options.limit ?? 100));
    if (options.seed !== undefined) {
      params.set("seed", String(options.seed));
    }

    const query = params.toString();
    const response = await fetchWithAuth(`${API_BASE}/due/batch${query ? `?${query}` : ""}`, {
      credentials: "include",
      cache: "no-store",
      signal: init.signal,
    });

    if (!response.ok) {
      await this.parseError(response, "Failed to fetch due cards");
    }

    const data = await response.json();
    return parseDueBatchResponse(data);
  }

  async getCard(cardId: number): Promise<Card> {
    const response = await fetchWithAuth(`${API_BASE}/${cardId}`, {
      credentials: "include",
    });

    if (!response.ok) {
      await this.parseError(response, "Failed to fetch card");
    }

    const data = await response.json();
    return parseCard(data, "Get card response");
  }

  async createCard(payload: CreateCardRequest): Promise<Card> {
    const response = await fetchWithAuth(API_BASE, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      await this.parseError(response, "Failed to create card");
    }

    const data = await response.json();
    return parseCard(data, "Create card response");
  }

  async updateCard(cardId: number, payload: UpdateCardRequest): Promise<Card> {
    if ((payload as { deck_id?: number | null }).deck_id === null) {
      throw new Error("deck_id cannot be null. Omit deck_id to keep the current deck.");
    }

    const response = await fetchWithAuth(`${API_BASE}/${cardId}`, {
      method: "PUT",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      await this.parseError(response, "Failed to update card");
    }

    const data = await response.json();
    return parseCard(data, "Update card response");
  }

  async deleteCard(cardId: number): Promise<void> {
    const response = await fetchWithAuth(`${API_BASE}/${cardId}`, {
      method: "DELETE",
      credentials: "include",
    });

    if (!response.ok) {
      await this.parseError(response, "Failed to delete card");
    }
  }

  async previewCard(cardId: number): Promise<NextStatesResponse> {
    const response = await fetchWithAuth(`${API_BASE}/${cardId}/preview`, {
      credentials: "include",
    });

    if (!response.ok) {
      await this.parseError(response, "Failed to preview card schedule");
    }

    const data = await response.json();
    return parseNextStatesResponse(data);
  }

  /**
   * Submit a rating. `payload.request_id` is the idempotency key: reuse the
   * exact same key (and payload) when retrying; never generate a fresh key
   * for a retry of the same intent.
   */
  async reviewCard(
    cardId: number,
    payload: ReviewRequest,
    init: RequestOptions = {},
  ): Promise<ReviewResponse> {
    const response = await fetchWithAuth(`${API_BASE}/${cardId}/review`, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: init.signal,
    });

    if (!response.ok) {
      await this.parseError(response, "Failed to submit review");
    }

    const data = await response.json();
    return parseReviewResponse(data);
  }
}

export const cardsApi = new CardsApi();
