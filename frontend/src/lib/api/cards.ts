import { parseApiError } from "@/lib/api-error";
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

  return {
    card,
    next_states: nextStates,
    message: value.message,
  };
}

class CardsApi {
  private async parseError(response: Response, fallback: string): Promise<never> {
    const data = await response.json().catch(() => null);
    if (data) {
      throw new Error(parseApiError(data));
    }

    throw new Error(fallback);
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

  async getDueCards(options: DueCardsOptions = {}): Promise<Card[]> {
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
    });

    if (!response.ok) {
      await this.parseError(response, "Failed to fetch due cards");
    }

    const data = await response.json();
    return parseCardArray(data, "Due cards response");
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

  async reviewCard(cardId: number, payload: ReviewRequest): Promise<ReviewResponse> {
    const response = await fetchWithAuth(`${API_BASE}/${cardId}/review`, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      await this.parseError(response, "Failed to submit review");
    }

    const data = await response.json();
    return parseReviewResponse(data);
  }
}

export const cardsApi = new CardsApi();
