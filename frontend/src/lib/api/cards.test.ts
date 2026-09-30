/**
 * Tests for the `cardsApi` client.
 *
 * Covers listing with filters, the due endpoints (legacy list, summary,
 * batch), runtime parsing of nested review/scheduling shapes, the review
 * receipt fields (idempotency), and the `deck_id === null` guard on update.
 *
 * Run with: `bun test src/lib/api/cards.test.ts`
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { __resetForTests } from "./fetch-with-auth";
import {
  cardsApi,
  type Card,
  type DueSummary,
  type NextStatesResponse,
  type ReviewResponse,
} from "./cards";
import {
  installFetchMock,
  installWindowMock,
  jsonResponse,
  restoreFetch,
  restoreWindow,
  type FetchMock,
} from "@/lib/test-utils";

function makeCard(overrides: Partial<Card> = {}): Card {
  return {
    id: 1,
    sequence: 1,
    front_content: "front",
    back_content: "back",
    meta_data: {},
    tags: [],
    deck_id: 1,
    difficulty: 0,
    stability: 0,
    state: "new",
    reps: 0,
    lapses: 0,
    review_version: 0,
    last_review_at: null,
    next_review_at: null,
    created_at: "2025-01-01T00:00:00Z",
    updated_at: "2025-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeNextStates(): NextStatesResponse {
  const info = { interval_days: 1, new_difficulty: 0.3, new_stability: 1.5 };
  return { again: info, hard: info, good: info, easy: info };
}

function makeSummary(total: number, deckId: number | null = null): DueSummary {
  return {
    scheduled_due_count: total,
    new_count: 0,
    total,
    as_of: "2026-09-29T12:00:00Z",
    deck_id: deckId,
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

describe("cardsApi.listCards", () => {
  test("emits only limit/offset when no filters are given", async () => {
    fetchMock.enqueue(() =>
      jsonResponse({ items: [], total: 0, limit: 100, offset: 0 }),
    );

    await cardsApi.listCards();

    expect(fetchMock.calls[0].url).toBe(
      "/api/v1/cards?limit=100&offset=0",
    );
  });

  test("encodes deck_id, state, and tag filters", async () => {
    fetchMock.enqueue(() =>
      jsonResponse({ items: [makeCard()], total: 1, limit: 20, offset: 0 }),
    );

    const response = await cardsApi.listCards({
      deck_id: 7,
      state: "review",
      tag: "kanji",
      limit: 20,
      offset: 0,
    });

    expect(response.items).toHaveLength(1);
    const url = new URL(fetchMock.calls[0].url, "http://localhost");
    expect(url.pathname).toBe("/api/v1/cards");
    expect(url.searchParams.get("deck_id")).toBe("7");
    expect(url.searchParams.get("state")).toBe("review");
    expect(url.searchParams.get("tag")).toBe("kanji");
    expect(url.searchParams.get("limit")).toBe("20");
    expect(url.searchParams.get("offset")).toBe("0");
  });

  test("rejects responses with an invalid card state", async () => {
    fetchMock.enqueue(() =>
      jsonResponse({
        items: [{ ...makeCard(), state: "graduated" }],
        total: 1,
        limit: 20,
        offset: 0,
      }),
    );

    await expect(cardsApi.listCards()).rejects.toThrow(/invalid state/i);
  });

  test("rejects a card without a review_version (contract marker)", async () => {
    const withoutVersion: Record<string, unknown> = { ...makeCard() };
    delete withoutVersion.review_version;
    fetchMock.enqueue(() =>
      jsonResponse({
        items: [withoutVersion],
        total: 1,
        limit: 20,
        offset: 0,
      }),
    );

    await expect(cardsApi.listCards()).rejects.toThrow(/invalid review_version/i);
  });

  test("rejects when items is missing or wrong type", async () => {
    fetchMock.enqueue(() =>
      jsonResponse({ items: "not-an-array", total: 0, limit: 0, offset: 0 }),
    );

    await expect(cardsApi.listCards()).rejects.toThrow(/expected array/i);
  });

  test("surfaces a parsed detail message on error", async () => {
    fetchMock.enqueue(() =>
      jsonResponse({ detail: "deck not found" }, { status: 404 }),
    );

    await expect(cardsApi.listCards({ deck_id: 999 })).rejects.toThrow(
      "deck not found",
    );
  });
});

describe("cardsApi.getDueCards", () => {
  test("defaults limit to 20 and omits deck_id when not given", async () => {
    fetchMock.enqueue(() => jsonResponse([]));

    await cardsApi.getDueCards();

    expect(fetchMock.calls[0].url).toBe("/api/v1/cards/due?limit=20");
  });

  test("includes deck_id when provided", async () => {
    fetchMock.enqueue(() => jsonResponse([makeCard({ id: 42 })]));

    const cards = await cardsApi.getDueCards({ deck_id: 3, limit: 5 });

    expect(cards).toHaveLength(1);
    expect(cards[0].id).toBe(42);
    expect(fetchMock.calls[0].url).toBe(
      "/api/v1/cards/due?deck_id=3&limit=5",
    );
  });

  test("includes seed when provided", async () => {
    fetchMock.enqueue(() => jsonResponse([]));

    await cardsApi.getDueCards({ deck_id: 3, limit: 5, seed: 12345 });

    const url = new URL(fetchMock.calls[0].url, "http://localhost");
    expect(url.searchParams.get("seed")).toBe("12345");
  });

  test("sends seed 0 (a valid seed, not omitted as falsy)", async () => {
    fetchMock.enqueue(() => jsonResponse([]));

    await cardsApi.getDueCards({ seed: 0 });

    const url = new URL(fetchMock.calls[0].url, "http://localhost");
    expect(url.searchParams.get("seed")).toBe("0");
  });

  test("omits seed when not provided", async () => {
    fetchMock.enqueue(() => jsonResponse([]));

    await cardsApi.getDueCards({ deck_id: 3, limit: 5 });

    const url = new URL(fetchMock.calls[0].url, "http://localhost");
    expect(url.searchParams.has("seed")).toBe(false);
  });
});

describe("cardsApi.getDueSummary", () => {
  test("requests the summary for all decks by default", async () => {
    fetchMock.enqueue(() => jsonResponse(makeSummary(12)));

    const summary = await cardsApi.getDueSummary();

    expect(fetchMock.calls[0].url).toBe("/api/v1/cards/due/summary");
    expect(summary.total).toBe(12);
  });

  test("includes deck_id for a deck-scoped summary", async () => {
    fetchMock.enqueue(() => jsonResponse(makeSummary(4, 3)));

    const summary = await cardsApi.getDueSummary({ deck_id: 3 });

    const url = new URL(fetchMock.calls[0].url, "http://localhost");
    expect(url.pathname).toBe("/api/v1/cards/due/summary");
    expect(url.searchParams.get("deck_id")).toBe("3");
    expect(summary.deck_id).toBe(3);
  });

  test("rejects a summary whose total does not match the breakdown", async () => {
    fetchMock.enqueue(() =>
      jsonResponse({ ...makeSummary(2), total: 5 }),
    );

    await expect(cardsApi.getDueSummary()).rejects.toThrow(
      /total does not match/i,
    );
  });

  test("surfaces a parsed detail message on error", async () => {
    fetchMock.enqueue(() =>
      jsonResponse({ detail: "deck not found" }, { status: 404 }),
    );

    await expect(cardsApi.getDueSummary({ deck_id: 9 })).rejects.toThrow(
      "deck not found",
    );
  });
});

describe("cardsApi.getDueBatch", () => {
  test("defaults limit to 100 and parses items with the same-snapshot summary", async () => {
    fetchMock.enqueue(() =>
      jsonResponse({
        items: [makeCard({ id: 7 })],
        summary: makeSummary(101),
        limit: 100,
      }),
    );

    const batch = await cardsApi.getDueBatch();

    const url = new URL(fetchMock.calls[0].url, "http://localhost");
    expect(url.pathname).toBe("/api/v1/cards/due/batch");
    expect(url.searchParams.get("limit")).toBe("100");
    expect(batch.items).toHaveLength(1);
    expect(batch.summary.total).toBe(101);
  });

  test("passes deck_id and seed through", async () => {
    fetchMock.enqueue(() =>
      jsonResponse({ items: [], summary: makeSummary(0, 5), limit: 25 }),
    );

    const batch = await cardsApi.getDueBatch({ deck_id: 5, limit: 25, seed: 0 });

    const url = new URL(fetchMock.calls[0].url, "http://localhost");
    expect(url.searchParams.get("deck_id")).toBe("5");
    expect(url.searchParams.get("limit")).toBe("25");
    expect(url.searchParams.get("seed")).toBe("0");
    expect(batch.items).toHaveLength(0);
    expect(batch.summary.total).toBe(0);
  });
});

describe("cardsApi.updateCard", () => {
  test("rejects deck_id === null before issuing a request", async () => {
    await expect(
      // Cast: the public type forbids null, but we explicitly guard so
      // a callsite that defeats the type checker still fails loudly.
      cardsApi.updateCard(1, { deck_id: null } as unknown as { deck_id?: number }),
    ).rejects.toThrow(/deck_id cannot be null/i);
    expect(fetchMock.calls).toHaveLength(0);
  });

  test("PUTs the provided payload otherwise", async () => {
    fetchMock.enqueue(() => jsonResponse(makeCard({ id: 1, deck_id: 9 })));

    const card = await cardsApi.updateCard(1, { deck_id: 9 });

    expect(card.deck_id).toBe(9);
    const call = fetchMock.calls[0];
    expect(call.url).toBe("/api/v1/cards/1");
    expect(call.init?.method).toBe("PUT");
    expect(JSON.parse(call.init?.body as string)).toEqual({ deck_id: 9 });
  });
});

describe("cardsApi.reviewCard / previewCard", () => {
  test("review parses card + next_states + message + receipt fields", async () => {
    const next = makeNextStates();
    const responseBody: ReviewResponse = {
      card: makeCard({ id: 5, state: "review", review_version: 1 }),
      next_states: next,
      message: "ok",
      request_id: "req-9",
      review_id: 77,
      replayed: false,
      summary: makeSummary(4),
    };
    fetchMock.enqueue(() => jsonResponse(responseBody));

    const result = await cardsApi.reviewCard(5, { rating: 3, request_id: "req-9" });

    expect(result.card.id).toBe(5);
    expect(result.message).toBe("ok");
    expect(result.next_states.good.interval_days).toBe(1);
    expect(result.request_id).toBe("req-9");
    expect(result.review_id).toBe(77);
    expect(result.replayed).toBe(false);
    expect(result.summary?.total).toBe(4);
    const call = fetchMock.calls[0];
    expect(call.url).toBe("/api/v1/cards/5/review");
    expect(call.init?.method).toBe("POST");
    expect(JSON.parse(call.init?.body as string)).toEqual({
      rating: 3,
      request_id: "req-9",
    });
  });

  test("review forwards the version guard and scope fields verbatim", async () => {
    fetchMock.enqueue(() =>
      jsonResponse({
        card: makeCard({ id: 5 }),
        next_states: makeNextStates(),
        message: "ok",
        request_id: "req-9",
        review_id: 77,
        replayed: true,
        summary: null,
      }),
    );

    await cardsApi.reviewCard(5, {
      rating: 1,
      review_duration_ms: 2500,
      request_id: "req-9",
      expected_review_version: 3,
      scope_deck_id: 2,
    });

    const body = JSON.parse(fetchMock.calls[0].init?.body as string);
    expect(body).toEqual({
      rating: 1,
      review_duration_ms: 2500,
      request_id: "req-9",
      expected_review_version: 3,
      scope_deck_id: 2,
    });
  });

  test("a response omitting the summary field parses as null", async () => {
    fetchMock.enqueue(() =>
      jsonResponse({
        card: makeCard({ id: 5 }),
        next_states: makeNextStates(),
        message: "ok",
        request_id: "req-9",
        review_id: 77,
        replayed: false,
        // summary omitted entirely (serializer with exclude_none)
      }),
    );

    const result = await cardsApi.reviewCard(5, { rating: 3, request_id: "req-9" });

    expect(result.summary).toBeNull();
  });

  test("review rejects a response missing the receipt fields (old server)", async () => {
    fetchMock.enqueue(() =>
      jsonResponse({
        card: makeCard(),
        next_states: makeNextStates(),
        message: "ok",
      }),
    );

    await expect(
      cardsApi.reviewCard(5, { rating: 3, request_id: "req-9" }),
    ).rejects.toThrow(/invalid request_id/i);
  });

  test("preview returns parsed next_states", async () => {
    fetchMock.enqueue(() => jsonResponse(makeNextStates()));

    const result = await cardsApi.previewCard(8);

    expect(result.again.interval_days).toBe(1);
    expect(fetchMock.calls[0].url).toBe("/api/v1/cards/8/preview");
  });

  test("preview rejects when a scheduling bucket is malformed", async () => {
    const bad = { ...makeNextStates(), easy: { interval_days: "soon" } };
    fetchMock.enqueue(() => jsonResponse(bad));

    await expect(cardsApi.previewCard(8)).rejects.toThrow(
      /Next states\.easy: invalid interval_days/i,
    );
  });
});

describe("cardsApi.createCard / deleteCard", () => {
  test("createCard posts with body and credentials", async () => {
    fetchMock.enqueue(() => jsonResponse(makeCard({ id: 99 })));

    const card = await cardsApi.createCard({
      deck_id: 1,
      front_content: "f",
      back_content: "b",
    });

    expect(card.id).toBe(99);
    const call = fetchMock.calls[0];
    expect(call.url).toBe("/api/v1/cards");
    expect(call.init?.method).toBe("POST");
    expect(call.init?.credentials).toBe("include");
    expect(JSON.parse(call.init?.body as string)).toEqual({
      deck_id: 1,
      front_content: "f",
      back_content: "b",
    });
  });

  test("deleteCard surfaces parsed detail on failure", async () => {
    fetchMock.enqueue(() =>
      jsonResponse({ detail: "card already gone" }, { status: 404 }),
    );

    await expect(cardsApi.deleteCard(1)).rejects.toThrow("card already gone");
  });
});
