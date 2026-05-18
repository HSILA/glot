/**
 * Session page — API contract tests.
 *
 * The project does not have a React/DOM render environment, so these tests
 * guard the API layer as the session page uses it rather than testing the
 * component directly. They are colocated with the session page so they are
 * easy to extend when component-level tests become feasible.
 *
 * What is covered:
 *   - getDueCards with limit:100 (the session overrides the API default of 20)
 *   - getDueCards with and without deck_id (single-deck vs mixed-review modes)
 *   - Empty due-cards list (the "All caught up" state)
 *   - reviewCard sends all four rating values (1-4) plus review_duration_ms
 *   - reviewCard failure surfaces a meaningful error message
 *
 * What is NOT covered here (requires a DOM/React render environment):
 *   - Rating buttons are visible only after the card is flipped
 *   - Clicking a rating button calls reviewCard and advances the session
 *   - Keyboard shortcuts 1-4 trigger the correct rating exactly once
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { __resetForTests } from "@/lib/api/fetch-with-auth";
import {
  cardsApi,
  type Card,
  type NextStatesResponse,
} from "@/lib/api/cards";
import { getSessionProgress } from "./session-progress";
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
    front_content: "Q",
    back_content: "A",
    meta_data: {},
    tags: [],
    deck_id: 5,
    difficulty: 0.3,
    stability: 4.0,
    state: "review",
    reps: 3,
    lapses: 0,
    last_review_at: "2026-05-10T10:00:00Z",
    next_review_at: "2026-05-17T10:00:00Z",
    created_at: "2025-01-01T00:00:00Z",
    updated_at: "2025-05-10T10:00:00Z",
    ...overrides,
  };
}

function makeNextStates(): NextStatesResponse {
  const info = { interval_days: 1, new_difficulty: 0.3, new_stability: 1.5 };
  return { again: info, hard: info, good: info, easy: info };
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

describe("session — progress display", () => {
  test("keeps the original session total while advancing through reviewed cards", () => {
    const firstCard = getSessionProgress({ sessionTotal: 3, reviewedCount: 0, hasCurrentCard: true });
    expect(firstCard).toMatchObject({
      cardNumber: 1,
      totalCards: 3,
      remaining: 3,
    });
    expect(firstCard.progressPercent).toBeCloseTo(100 / 3);

    const secondCard = getSessionProgress({ sessionTotal: 3, reviewedCount: 1, hasCurrentCard: true });
    expect(secondCard).toMatchObject({
      cardNumber: 2,
      totalCards: 3,
      remaining: 2,
    });
    expect(secondCard.progressPercent).toBeCloseTo(200 / 3);

    expect(getSessionProgress({ sessionTotal: 3, reviewedCount: 3, hasCurrentCard: false })).toMatchObject({
      cardNumber: 3,
      totalCards: 3,
      progressPercent: 100,
      remaining: 0,
    });
  });

  test("shows zero progress for an empty session", () => {
    expect(getSessionProgress({ sessionTotal: 0, reviewedCount: 0, hasCurrentCard: false })).toMatchObject({
      cardNumber: 0,
      totalCards: 0,
      progressPercent: 0,
      remaining: 0,
    });
  });
});

describe("session — due-card loading", () => {
  test("requests limit:100 for a deck-specific session (not the API default of 20)", async () => {
    fetchMock.enqueue(() => jsonResponse([makeCard()]));

    const cards = await cardsApi.getDueCards({ deck_id: 5, limit: 100 });

    expect(cards).toHaveLength(1);
    const url = new URL(fetchMock.calls[0].url, "http://localhost");
    expect(url.searchParams.get("deck_id")).toBe("5");
    expect(url.searchParams.get("limit")).toBe("100");
  });

  test("omits deck_id and requests limit:100 for a mixed-review session", async () => {
    fetchMock.enqueue(() => jsonResponse([makeCard(), makeCard({ id: 2 })]));

    const cards = await cardsApi.getDueCards({ limit: 100 });

    expect(cards).toHaveLength(2);
    expect(fetchMock.calls[0].url).toBe("/api/v1/cards/due?limit=100");
  });

  test("returns an empty array when no cards are due", async () => {
    fetchMock.enqueue(() => jsonResponse([]));

    const cards = await cardsApi.getDueCards({ limit: 100 });

    expect(cards).toHaveLength(0);
  });
});

describe("session — rating a card", () => {
  test.each([1, 2, 3, 4] as const)(
    "rating %i is forwarded verbatim with review_duration_ms",
    async (rating) => {
      fetchMock.enqueue(() =>
        jsonResponse({
          card: makeCard(),
          next_states: makeNextStates(),
          message: "ok",
        }),
      );

      await cardsApi.reviewCard(1, { rating, review_duration_ms: 5000 });

      const call = fetchMock.calls[0];
      expect(call.url).toBe("/api/v1/cards/1/review");
      expect(call.init?.method).toBe("POST");
      const body = JSON.parse(call.init?.body as string);
      expect(body.rating).toBe(rating);
      expect(body.review_duration_ms).toBe(5000);
    },
  );

  test("surfaces the API error detail when the review request fails", async () => {
    fetchMock.enqueue(() =>
      jsonResponse({ detail: "Card not found" }, { status: 404 }),
    );

    await expect(
      cardsApi.reviewCard(999, { rating: 1, review_duration_ms: 1000 }),
    ).rejects.toThrow("Card not found");
  });
});
