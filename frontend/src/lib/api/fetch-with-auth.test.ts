/**
 * Regression tests for the centralized authenticated fetch.
 *
 * Run with: `bun test src/lib/api/fetch-with-auth.test.ts`
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
  __resetForTests,
  buildLoginUrl,
  fetchWithAuth,
  isSafeNext,
} from "./fetch-with-auth";

type FetchCall = { url: string; init: RequestInit | undefined };

type Handler = (call: FetchCall) => Response | Promise<Response>;

const originalFetch = globalThis.fetch;
const originalWindow = (globalThis as { window?: Window }).window;

let calls: FetchCall[] = [];
let handlers: Handler[] = [];
function installFetch(...stubHandlers: Handler[]): void {
  calls = [];
  handlers = [...stubHandlers];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const call: FetchCall = { url, init };
    calls.push(call);
    const handler = handlers.shift();
    if (!handler) {
      throw new Error(`Unexpected fetch: ${url}`);
    }
    return handler(call);
  }) as typeof fetch;
}

function installWindow(pathname = "/decks", search = "", hash = ""): void {
  const replaced: string[] = [];
  (globalThis as { window?: unknown }).window = {
    location: {
      pathname,
      search,
      hash,
      replace: (url: string) => replaced.push(url),
    },
    __replaced: replaced,
  } as unknown as Window;
}

function getReplacedUrls(): string[] {
  const w = (globalThis as { window?: { __replaced?: string[] } }).window;
  return w?.__replaced ?? [];
}

beforeEach(() => {
  __resetForTests();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalWindow === undefined) {
    delete (globalThis as { window?: unknown }).window;
  } else {
    (globalThis as { window?: unknown }).window = originalWindow;
  }
});

describe("isSafeNext", () => {
  test("accepts simple absolute paths", () => {
    expect(isSafeNext("/decks")).toBe(true);
    expect(isSafeNext("/decks/42?tab=cards")).toBe(true);
  });

  test("rejects empty / null", () => {
    expect(isSafeNext(null)).toBe(false);
    expect(isSafeNext(undefined)).toBe(false);
    expect(isSafeNext("")).toBe(false);
  });

  test("rejects protocol-relative URLs", () => {
    expect(isSafeNext("//evil.com")).toBe(false);
    expect(isSafeNext("//evil.com/path")).toBe(false);
  });

  test("rejects absolute URLs and backslash tricks", () => {
    expect(isSafeNext("https://evil.com")).toBe(false);
    expect(isSafeNext("/\\evil.com")).toBe(false);
    expect(isSafeNext("/path\\with-backslash")).toBe(false);
  });

  test("rejects relative paths", () => {
    expect(isSafeNext("decks")).toBe(false);
    expect(isSafeNext("./decks")).toBe(false);
  });
});

describe("buildLoginUrl", () => {
  test("returns plain /login for public paths", () => {
    installWindow("/login", "?next=/decks");
    expect(buildLoginUrl("/login")).toBe("/login");
    expect(buildLoginUrl("/register")).toBe("/login");
  });

  test("encodes pathname + search + hash as next", () => {
    installWindow("/decks/42", "?tab=cards", "#row-3");
    expect(buildLoginUrl("/decks/42")).toBe(
      `/login?next=${encodeURIComponent("/decks/42?tab=cards#row-3")}`,
    );
  });
});

describe("fetchWithAuth", () => {
  test("returns response as-is on success", async () => {
    installWindow();
    installFetch(() => new Response("ok", { status: 200 }));

    const res = await fetchWithAuth("/api/v1/decks");
    expect(res.status).toBe(200);
    expect(calls.length).toBe(1);
    expect(calls[0].url).toBe("/api/v1/decks");
    expect(calls[0].init?.credentials).toBe("include");
  });

  test("on 401/403, refreshes once and retries", async () => {
    installWindow();
    installFetch(
      () => new Response(null, { status: 403 }),
      (call) => {
        expect(call.url).toBe("/api/v1/auth/refresh");
        expect(call.init?.method).toBe("POST");
        return new Response(null, { status: 200 });
      },
      () => new Response(JSON.stringify({ items: [] }), { status: 200 }),
    );

    const res = await fetchWithAuth("/api/v1/decks");
    expect(res.status).toBe(200);
    expect(calls.map((c) => c.url)).toEqual([
      "/api/v1/decks",
      "/api/v1/auth/refresh",
      "/api/v1/decks",
    ]);
    expect(getReplacedUrls()).toEqual([]);
  });

  test("redirects to /login?next=<current> when refresh fails after 401/403", async () => {
    installWindow("/decks/42", "?tab=cards");
    installFetch(
      () => new Response(null, { status: 401 }),
      () => new Response(null, { status: 403 }),
    );

    const res = await fetchWithAuth("/api/v1/decks/42");
    expect(res.status).toBe(401);
    expect(getReplacedUrls()).toEqual([
      `/login?next=${encodeURIComponent("/decks/42?tab=cards")}`,
    ]);
  });

  test("does not redirect when redirectOnAuthFailure=false", async () => {
    installWindow("/decks/42");
    installFetch(
      () => new Response(null, { status: 401 }),
      () => new Response(null, { status: 401 }),
    );

    const res = await fetchWithAuth("/api/v1/auth/me", {
      redirectOnAuthFailure: false,
    });
    expect(res.status).toBe(401);
    expect(getReplacedUrls()).toEqual([]);
  });

  test("concurrent 401s share a single refresh round-trip", async () => {
    installWindow();
    let refreshCalls = 0;
    installFetch(
      () => new Response(null, { status: 401 }),
      () => new Response(null, { status: 401 }),
      (call) => {
        expect(call.url).toBe("/api/v1/auth/refresh");
        refreshCalls += 1;
        return new Response(null, { status: 200 });
      },
      () => new Response(JSON.stringify({ a: 1 }), { status: 200 }),
      () => new Response(JSON.stringify({ b: 2 }), { status: 200 }),
    );

    const [a, b] = await Promise.all([
      fetchWithAuth("/api/v1/decks"),
      fetchWithAuth("/api/v1/cards"),
    ]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(refreshCalls).toBe(1);
  });

  test("does not refresh on non-401 errors", async () => {
    installWindow();
    installFetch(() => new Response("server error", { status: 500 }));

    const res = await fetchWithAuth("/api/v1/decks");
    expect(res.status).toBe(500);
    expect(calls.length).toBe(1);
  });

  test("propagates network errors without redirecting", async () => {
    installWindow();
    installFetch(() => {
      throw new Error("network down");
    });

    await expect(fetchWithAuth("/api/v1/decks")).rejects.toThrow(
      "network down",
    );
    expect(getReplacedUrls()).toEqual([]);
  });
});
