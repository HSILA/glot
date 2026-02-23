import { parseApiError } from "@/lib/api-error";

export type CardState = "new" | "learning" | "review" | "relearning";

export interface Card {
  id: number;
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

export interface DueCardsOptions {
  deck_id?: number;
  limit?: number;
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
  deck_id?: number | null;
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

class CardsApi {
  private async parseError(response: Response, fallback: string): Promise<never> {
    const data = await response.json().catch(() => null);
    if (data) {
      throw new Error(parseApiError(data));
    }

    throw new Error(fallback);
  }

  async listCards(options: ListCardsOptions = {}): Promise<Card[]> {
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
    const response = await fetch(`${API_BASE}${query ? `?${query}` : ""}`, {
      credentials: "include",
    });

    if (!response.ok) {
      await this.parseError(response, "Failed to fetch cards");
    }

    return response.json();
  }

  async getDueCards(options: DueCardsOptions = {}): Promise<Card[]> {
    const params = new URLSearchParams();

    if (options.deck_id !== undefined) {
      params.set("deck_id", String(options.deck_id));
    }
    params.set("limit", String(options.limit ?? 20));

    const query = params.toString();
    const response = await fetch(`${API_BASE}/due${query ? `?${query}` : ""}`, {
      credentials: "include",
    });

    if (!response.ok) {
      await this.parseError(response, "Failed to fetch due cards");
    }

    return response.json();
  }

  async getCard(cardId: number): Promise<Card> {
    const response = await fetch(`${API_BASE}/${cardId}`, {
      credentials: "include",
    });

    if (!response.ok) {
      await this.parseError(response, "Failed to fetch card");
    }

    return response.json();
  }

  async createCard(payload: CreateCardRequest): Promise<Card> {
    const response = await fetch(API_BASE, {
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

    return response.json();
  }

  async updateCard(cardId: number, payload: UpdateCardRequest): Promise<Card> {
    const response = await fetch(`${API_BASE}/${cardId}`, {
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

    return response.json();
  }

  async deleteCard(cardId: number): Promise<void> {
    const response = await fetch(`${API_BASE}/${cardId}`, {
      method: "DELETE",
      credentials: "include",
    });

    if (!response.ok) {
      await this.parseError(response, "Failed to delete card");
    }
  }

  async previewCard(cardId: number): Promise<NextStatesResponse> {
    const response = await fetch(`${API_BASE}/${cardId}/preview`, {
      credentials: "include",
    });

    if (!response.ok) {
      await this.parseError(response, "Failed to preview card schedule");
    }

    return response.json();
  }

  async reviewCard(cardId: number, payload: ReviewRequest): Promise<ReviewResponse> {
    const response = await fetch(`${API_BASE}/${cardId}/review`, {
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

    return response.json();
  }
}

export const cardsApi = new CardsApi();
