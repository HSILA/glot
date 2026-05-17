/**
 * Tests for proxy.ts redirect logic.
 *
 * We test the pure `resolveAuthPageRedirect` helper in isolation; the full
 * Next.js edge-runtime integration should be verified manually (see bottom).
 *
 * Run with: `bun test src/proxy.test.ts`
 */

import { describe, expect, mock, test } from "bun:test";

// Stub next/server before proxy.ts is loaded so the import doesn't fail
// outside the Next.js runtime.
mock.module("next/server", () => ({
  NextResponse: {
    redirect: (url: URL) => ({ _type: "redirect", href: url.href }),
    next: () => ({ _type: "next" }),
  },
}));

// Dynamic import ensures the mock above is registered first.
const { resolveAuthPageRedirect } = await import("./proxy");

function params(query: string): URLSearchParams {
  return new URLSearchParams(query);
}

describe("resolveAuthPageRedirect", () => {
  test("no next param → falls back to /", () => {
    expect(resolveAuthPageRedirect(params(""))).toBe("/");
  });

  test("safe absolute-path next → returned as-is", () => {
    expect(resolveAuthPageRedirect(params(`next=${encodeURIComponent("/decks")}`))).toBe("/decks");
    expect(
      resolveAuthPageRedirect(params(`next=${encodeURIComponent("/decks/42?tab=cards")}`)),
    ).toBe("/decks/42?tab=cards");
  });

  test("protocol-relative next → falls back to /", () => {
    expect(resolveAuthPageRedirect(params(`next=${encodeURIComponent("//evil.com")}`))).toBe("/");
  });

  test("absolute URL next → falls back to /", () => {
    expect(
      resolveAuthPageRedirect(params(`next=${encodeURIComponent("https://evil.com/steal")}`)),
    ).toBe("/");
  });

  test("backslash tricks → fall back to /", () => {
    expect(resolveAuthPageRedirect(params(`next=${encodeURIComponent("/\\evil.com")}`))).toBe("/");
    expect(
      resolveAuthPageRedirect(params(`next=${encodeURIComponent("/path\\with-backslash")}`)),
    ).toBe("/");
  });

  test("relative path → falls back to /", () => {
    expect(resolveAuthPageRedirect(params(`next=${encodeURIComponent("decks")}`))).toBe("/");
    expect(resolveAuthPageRedirect(params(`next=${encodeURIComponent("./decks")}`))).toBe("/");
  });
});

/*
 * Manual verification checklist (requires a running dev server):
 *
 * 1. Sign in, then visit /login?next=/decks  → should land on /decks
 * 2. Sign in, then visit /login              → should land on /
 * 3. Sign in, then visit /login?next=//evil.com  → should land on /  (open-redirect blocked)
 * 4. Unauthenticated visit to /decks         → should redirect to /login?next=%2Fdecks
 * 5. After sign-in from step 4              → should land on /decks
 */
