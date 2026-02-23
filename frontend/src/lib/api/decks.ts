import { parseApiError } from "@/lib/api-error";

export interface Deck {
  id: number;
  name: string;
  description: string | null;
  parent_id: number | null;
  created_at: string;
  updated_at: string;
}

export interface ListDecksOptions {
  parent_id?: number;
  limit?: number;
  offset?: number;
}

export interface CreateDeckRequest {
  name: string;
  description?: string | null;
  parent_id?: number | null;
}

export interface UpdateDeckRequest {
  name?: string;
  description?: string | null;
  parent_id?: number | null;
}

const API_BASE = "/api/v1/decks";

class DecksApi {
  private async parseError(response: Response, fallback: string): Promise<never> {
    const data = await response.json().catch(() => null);
    if (data) {
      throw new Error(parseApiError(data));
    }

    throw new Error(fallback);
  }

  async listDecks(options: ListDecksOptions = {}): Promise<Deck[]> {
    const params = new URLSearchParams();

    if (options.parent_id !== undefined) {
      params.set("parent_id", String(options.parent_id));
    }
    params.set("limit", String(options.limit ?? 100));
    params.set("offset", String(options.offset ?? 0));

    const query = params.toString();
    const response = await fetch(`${API_BASE}${query ? `?${query}` : ""}`, {
      credentials: "include",
    });

    if (!response.ok) {
      await this.parseError(response, "Failed to fetch decks");
    }

    return response.json();
  }

  async getDeck(deckId: number): Promise<Deck> {
    const response = await fetch(`${API_BASE}/${deckId}`, {
      credentials: "include",
    });

    if (!response.ok) {
      await this.parseError(response, "Failed to fetch deck");
    }

    return response.json();
  }

  async createDeck(payload: CreateDeckRequest): Promise<Deck> {
    const response = await fetch(API_BASE, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      await this.parseError(response, "Failed to create deck");
    }

    return response.json();
  }

  async updateDeck(deckId: number, payload: UpdateDeckRequest): Promise<Deck> {
    const response = await fetch(`${API_BASE}/${deckId}`, {
      method: "PUT",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      await this.parseError(response, "Failed to update deck");
    }

    return response.json();
  }

  async deleteDeck(deckId: number): Promise<void> {
    const response = await fetch(`${API_BASE}/${deckId}`, {
      method: "DELETE",
      credentials: "include",
    });

    if (!response.ok) {
      await this.parseError(response, "Failed to delete deck");
    }
  }
}

export const decksApi = new DecksApi();
