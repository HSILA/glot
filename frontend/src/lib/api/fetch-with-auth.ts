/**
 * Centralized authenticated fetch.
 *
 * On a 401/403 response, transparently calls POST /api/v1/auth/refresh once and
 * retries the original request. Concurrent callers share a single in-flight
 * refresh promise so a burst of requests that all see auth failures will only trigger
 * one refresh round-trip.
 *
 * If the refresh fails, navigates to /login?next=<current path> (unless
 * `redirectOnAuthFailure: false` is supplied, which the AuthProvider uses
 * for its /auth/me probe so it can render the login page without forcing a
 * full reload).
 */

const PUBLIC_PATHS = new Set(["/login", "/register"]);

const AUTH_FAILURE_STATUSES = new Set([401, 403]);

let refreshPromise: Promise<boolean> | null = null;

export function isSafeNext(value: string | null | undefined): value is string {
  if (!value) return false;
  if (!value.startsWith("/")) return false;
  // Reject protocol-relative URLs ("//evil.com/...") and backslash tricks.
  if (value.startsWith("//") || value.startsWith("/\\")) return false;
  if (value.includes("\\")) return false;
  return true;
}

export function buildLoginUrl(currentPath: string): string {
  if (PUBLIC_PATHS.has(currentPath)) return "/login";

  const search = typeof window !== "undefined" ? window.location.search : "";
  const hash = typeof window !== "undefined" ? window.location.hash : "";
  const next = `${currentPath}${search}${hash}`;

  if (!isSafeNext(next)) return "/login";
  return `/login?next=${encodeURIComponent(next)}`;
}

async function performRefresh(): Promise<boolean> {
  try {
    const r = await fetch("/api/v1/auth/refresh", {
      method: "POST",
      credentials: "include",
    });
    return r.ok;
  } catch {
    return false;
  }
}

function tryRefresh(): Promise<boolean> {
  if (!refreshPromise) {
    refreshPromise = performRefresh().finally(() => {
      // Defer so concurrent callers awaiting this promise all observe
      // the same resolved value before a fresh attempt can begin.
      queueMicrotask(() => {
        refreshPromise = null;
      });
    });
  }
  return refreshPromise;
}

function navigateToLogin(): void {
  if (typeof window === "undefined") return;
  const target = buildLoginUrl(window.location.pathname);
  // replace() avoids polluting history with the failed protected page.
  window.location.replace(target);
}

export interface FetchWithAuthInit extends RequestInit {
  /**
   * When refresh fails, redirect to /login?next=... by default.
   * The AuthProvider sets this to false for its initial /auth/me probe so
   * that React-side routing can handle the unauthenticated state.
   */
  redirectOnAuthFailure?: boolean;
}

export async function fetchWithAuth(
  input: RequestInfo | URL,
  init: FetchWithAuthInit = {},
): Promise<Response> {
  const { redirectOnAuthFailure = true, ...rest } = init;
  const opts: RequestInit = { credentials: "include", ...rest };

  let response = await fetch(input, opts);
  if (!AUTH_FAILURE_STATUSES.has(response.status)) return response;

  const refreshed = await tryRefresh();
  if (refreshed) {
    response = await fetch(input, opts);
    if (!AUTH_FAILURE_STATUSES.has(response.status)) return response;
  }

  if (redirectOnAuthFailure) {
    navigateToLogin();
  }
  return response;
}

/** Test-only helper. Resets the shared refresh promise between cases. */
export function __resetForTests(): void {
  refreshPromise = null;
}
