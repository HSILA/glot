/**
 * Shared helpers for unit tests under `bun:test`.
 *
 * The tests in this repo deliberately avoid a React/DOM renderer — we test
 * pure logic, API clients, and small utilities by stubbing `fetch` and
 * (where needed) `window.location`. These helpers keep that pattern
 * consistent so each test file does not reinvent its own scaffolding.
 *
 * Usage:
 *
 *   import { installFetchMock, installWindowMock, restoreGlobals } from "@/lib/test-utils";
 *
 *   beforeEach(() => snapshotGlobals());
 *   afterEach(() => restoreGlobals());
 *
 *   test("...", async () => {
 *     const fetchMock = installFetchMock([
 *       () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
 *     ]);
 *     // ... call code that uses fetch ...
 *     expect(fetchMock.calls[0].url).toBe("/api/v1/decks?limit=100&offset=0");
 *   });
 */

export interface FetchCall {
  url: string;
  init: RequestInit | undefined;
}

export type FetchHandler = (call: FetchCall) => Response | Promise<Response>;

export interface FetchMock {
  calls: FetchCall[];
  /** Append more handlers after the initial set (FIFO order). */
  enqueue(...handlers: FetchHandler[]): void;
}

const ORIGINAL_FETCH = globalThis.fetch;

/**
 * Replace `globalThis.fetch` with a FIFO queue of handlers. Each `fetch()`
 * call consumes the next handler; an unexpected extra call throws so the
 * test fails loudly rather than silently fetching the network.
 */
export function installFetchMock(handlers: FetchHandler[] = []): FetchMock {
  const calls: FetchCall[] = [];
  const queue: FetchHandler[] = [...handlers];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const call: FetchCall = { url, init };
    calls.push(call);
    const handler = queue.shift();
    if (!handler) {
      throw new Error(`Unexpected fetch: ${url}`);
    }
    return handler(call);
  }) as typeof fetch;

  return {
    calls,
    enqueue(...more: FetchHandler[]) {
      queue.push(...more);
    },
  };
}

export function restoreFetch(): void {
  globalThis.fetch = ORIGINAL_FETCH;
}

interface InstallWindowOptions {
  pathname?: string;
  search?: string;
  hash?: string;
}

export interface WindowMock {
  /** URLs passed to `window.location.replace` since the mock was installed. */
  replaced: string[];
}

const ORIGINAL_WINDOW = (globalThis as { window?: Window }).window;

/**
 * Install a minimal `window` stub for tests that hit `buildLoginUrl` or
 * other helpers that read `window.location`. Only the fields the code
 * under test actually touches are populated.
 */
export function installWindowMock(opts: InstallWindowOptions = {}): WindowMock {
  const { pathname = "/", search = "", hash = "" } = opts;
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
  return { replaced };
}

export function restoreWindow(): void {
  if (ORIGINAL_WINDOW === undefined) {
    delete (globalThis as { window?: unknown }).window;
  } else {
    (globalThis as { window?: unknown }).window = ORIGINAL_WINDOW;
  }
}

/** Helper to build a JSON response with sensible defaults. */
export function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers as Record<string, string> | undefined),
    },
  });
}
