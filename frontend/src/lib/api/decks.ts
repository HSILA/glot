import { parseApiError } from "@/lib/api-error";

export interface Deck {
  id: number;
  name: string;
  description: string | null;
  color: string | null;
  tags: string[] | null;
  created_at: string;
  updated_at: string;
}

export interface ListDecksOptions {
  limit?: number;
  offset?: number;
}

export interface CreateDeckRequest {
  name: string;
  description?: string | null;
  color?: string | null;
  tags?: string[] | null;
}

export interface UpdateDeckRequest {
  name?: string;
  description?: string | null;
  color?: string | null;
  tags?: string[] | null;
}

const API_BASE = "/api/v1/decks";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function assertDeck(value: unknown, context = "Deck"): asserts value is Deck {
  if (!isObject(value)) throw new Error(`${context}: expected object`);
  if (typeof value.id !== "number") throw new Error(`${context}: invalid id`);
  if (typeof value.name !== "string") throw new Error(`${context}: invalid name`);
  if (!(value.description === null || typeof value.description === "string")) {
    throw new Error(`${context}: invalid description`);
  }
  if (!(value.color === null || typeof value.color === "string")) {
    throw new Error(`${context}: invalid color`);
  }
  if (!(value.tags === null || (Array.isArray(value.tags) && value.tags.every(t => typeof t === "string")))) {
    throw new Error(`${context}: invalid tags`);
  }
  if (typeof value.created_at !== "string") throw new Error(`${context}: invalid created_at`);
  if (typeof value.updated_at !== "string") throw new Error(`${context}: invalid updated_at`);
}

function parseDeck(value: unknown, context = "Deck"): Deck {
  assertDeck(value, context);
  return value;
}

function parseDeckArray(value: unknown, context = "Decks"): Deck[] {
  if (!Array.isArray(value)) throw new Error(`${context}: expected array`);
  return value.map((item, index) => parseDeck(item, `${context}[${index}]`));
}

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

    params.set("limit", String(options.limit ?? 100));
    params.set("offset", String(options.offset ?? 0));

    const query = params.toString();
    const response = await fetch(`${API_BASE}${query ? `?${query}` : ""}`, {
      credentials: "include",
    });

    if (!response.ok) {
      await this.parseError(response, "Failed to fetch decks");
    }

    const data = await response.json();
    return parseDeckArray(data, "List decks response");
  }

  async getDeck(deckId: number): Promise<Deck> {
    const response = await fetch(`${API_BASE}/${deckId}`, {
      credentials: "include",
    });

    if (!response.ok) {
      await this.parseError(response, "Failed to fetch deck");
    }

    const data = await response.json();
    return parseDeck(data, "Get deck response");
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

    const data = await response.json();
    return parseDeck(data, "Create deck response");
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

    const data = await response.json();
    return parseDeck(data, "Update deck response");
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
