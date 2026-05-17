/**
 * Tests for the `decksApi` client.
 *
 * We stub `globalThis.fetch` (which `fetchWithAuth` ultimately calls) so
 * each test asserts on the full request shape — URL, method, headers,
 * body — as well as how responses are parsed and how backend errors
 * are surfaced via `parseApiError`.
 *
 * Run with: `bun test src/lib/api/decks.test.ts`
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { __resetForTests } from "./fetch-with-auth";
import { decksApi, type Deck } from "./decks";
import {
  installFetchMock,
  installWindowMock,
  jsonResponse,
  restoreFetch,
  restoreWindow,
  type FetchMock,
} from "@/lib/test-utils";

function makeDeck(overrides: Partial<Deck> = {}): Deck {
  return {
    id: 1,
    name: "Japanese N5",
    description: null,
    color: "#3b82f6",
    tags: null,
    cards_count: 0,
    new_count: 0,
    due_count: 0,
    last_studied_at: null,
    created_at: "2025-01-01T00:00:00Z",
    updated_at: "2025-01-01T00:00:00Z",
    ...overrides,
  };
}

let fetchMock: FetchMock;

beforeEach(() => {
  __resetForTests();
  installWindowMock();
  fetchMock = installFetchMock();
});

afterEach(() => {
  restoreFetch();
  restoreWindow();
});

describe("decksApi.listDecks", () => {
  test("builds default limit/offset query", async () => {
    fetchMock.enqueue(() => jsonResponse([makeDeck()]));

    const decks = await decksApi.listDecks();

    expect(decks).toHaveLength(1);
    expect(fetchMock.calls).toHaveLength(1);
    expect(fetchMock.calls[0].url).toBe(
      "/api/v1/decks?limit=100&offset=0",
    );
    expect(fetchMock.calls[0].init?.credentials).toBe("include");
  });

  test("honours custom limit/offset", async () => {
    fetchMock.enqueue(() => jsonResponse([]));

    await decksApi.listDecks({ limit: 25, offset: 50 });

    expect(fetchMock.calls[0].url).toBe(
      "/api/v1/decks?limit=25&offset=50",
    );
  });

  test("throws with parsed error message on non-OK response", async () => {
    fetchMock.enqueue(() =>
      jsonResponse({ detail: "Forbidden" }, { status: 403 }),
    );

    await expect(decksApi.listDecks()).rejects.toThrow("Forbidden");
  });

  test("uses fallback message when response body is not JSON", async () => {
    fetchMock.enqueue(
      () => new Response("upstream down", { status: 503 }),
    );

    await expect(decksApi.listDecks()).rejects.toThrow(
      "Failed to fetch decks",
    );
  });

  test("rejects with a clear error when an item is shaped wrong", async () => {
    fetchMock.enqueue(() =>
      jsonResponse([{ ...makeDeck(), cards_count: "lots" as unknown as number }]),
    );

    await expect(decksApi.listDecks()).rejects.toThrow(
      /invalid cards_count/i,
    );
  });

  test("rejects when the top-level payload is not an array", async () => {
    fetchMock.enqueue(() => jsonResponse({ items: [] }));

    await expect(decksApi.listDecks()).rejects.toThrow(/expected array/i);
  });
});

describe("decksApi.getDeck", () => {
  test("hits the deck-by-id URL and returns the parsed deck", async () => {
    fetchMock.enqueue(() => jsonResponse(makeDeck({ id: 42, name: "Kanji" })));

    const deck = await decksApi.getDeck(42);

    expect(deck.id).toBe(42);
    expect(deck.name).toBe("Kanji");
    expect(fetchMock.calls[0].url).toBe("/api/v1/decks/42");
  });

  test("surfaces 404 with parsed detail", async () => {
    fetchMock.enqueue(() =>
      jsonResponse({ detail: "Deck not found" }, { status: 404 }),
    );

    await expect(decksApi.getDeck(99)).rejects.toThrow("Deck not found");
  });
});

describe("decksApi.createDeck", () => {
  test("POSTs JSON payload with credentials", async () => {
    fetchMock.enqueue(() =>
      jsonResponse(makeDeck({ id: 7, name: "French", tags: ["fr"] })),
    );

    const deck = await decksApi.createDeck({
      name: "French",
      description: null,
      color: "#22c55e",
      tags: ["fr"],
    });

    expect(deck.id).toBe(7);
    const call = fetchMock.calls[0];
    expect(call.url).toBe("/api/v1/decks");
    expect(call.init?.method).toBe("POST");
    expect(call.init?.credentials).toBe("include");
    expect((call.init?.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/json",
    );
    expect(JSON.parse(call.init?.body as string)).toEqual({
      name: "French",
      description: null,
      color: "#22c55e",
      tags: ["fr"],
    });
  });

  test("propagates pydantic-style validation errors", async () => {
    fetchMock.enqueue(() =>
      jsonResponse(
        {
          detail: [
            { msg: "field required", loc: ["body", "name"] },
          ],
        },
        { status: 422 },
      ),
    );

    await expect(
      decksApi.createDeck({ name: "", description: null, color: null, tags: null }),
    ).rejects.toThrow("field required");
  });
});

describe("decksApi.updateDeck", () => {
  test("PUTs JSON payload to the deck URL", async () => {
    fetchMock.enqueue(() =>
      jsonResponse(makeDeck({ id: 3, name: "Renamed" })),
    );

    const deck = await decksApi.updateDeck(3, { name: "Renamed" });

    expect(deck.name).toBe("Renamed");
    const call = fetchMock.calls[0];
    expect(call.url).toBe("/api/v1/decks/3");
    expect(call.init?.method).toBe("PUT");
    expect(JSON.parse(call.init?.body as string)).toEqual({ name: "Renamed" });
  });
});

describe("decksApi.deleteDeck", () => {
  test("issues DELETE and resolves to void on 204", async () => {
    fetchMock.enqueue(() => new Response(null, { status: 204 }));

    await expect(decksApi.deleteDeck(5)).resolves.toBeUndefined();
    const call = fetchMock.calls[0];
    expect(call.url).toBe("/api/v1/decks/5");
    expect(call.init?.method).toBe("DELETE");
  });

  test("throws with parsed detail when the delete fails", async () => {
    fetchMock.enqueue(() =>
      jsonResponse({ detail: "Cannot delete" }, { status: 409 }),
    );

    await expect(decksApi.deleteDeck(5)).rejects.toThrow("Cannot delete");
  });
});
