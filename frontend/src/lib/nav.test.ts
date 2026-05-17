/**
 * Tests for `isActiveNavLink`, which decides nav-item highlighting in
 * both the desktop sidebar and the mobile bottom nav.
 *
 * Run with: `bun test src/lib/nav.test.ts`
 */

import { describe, expect, test } from "bun:test";

import { isActiveNavLink } from "./nav";

describe("isActiveNavLink", () => {
  test("root link is active only on exact match", () => {
    expect(isActiveNavLink("/", "/")).toBe(true);
    expect(isActiveNavLink("/decks", "/")).toBe(false);
    expect(isActiveNavLink("/decks/42", "/")).toBe(false);
    expect(isActiveNavLink("/library", "/")).toBe(false);
  });

  test("non-root link is active on exact match", () => {
    expect(isActiveNavLink("/decks", "/decks")).toBe(true);
    expect(isActiveNavLink("/library", "/library")).toBe(true);
  });

  test("non-root link is active for nested paths", () => {
    // Browsing /decks/42 should still highlight the Decks nav item.
    expect(isActiveNavLink("/decks/42", "/decks")).toBe(true);
    expect(isActiveNavLink("/decks/42/cards", "/decks")).toBe(true);
  });

  test("non-root link does NOT match unrelated paths with a shared prefix", () => {
    // Regression: a naive `startsWith` would (wrongly) match these.
    expect(isActiveNavLink("/decks-archive", "/decks")).toBe(false);
    expect(isActiveNavLink("/library-old", "/library")).toBe(false);
  });

  test("non-matching pathnames return false", () => {
    expect(isActiveNavLink("/library", "/decks")).toBe(false);
    expect(isActiveNavLink("/refinery", "/decks")).toBe(false);
  });

  test("trailing slash on pathname matches under the boundary check", () => {
    // /decks/ is nested under /decks.
    expect(isActiveNavLink("/decks/", "/decks")).toBe(true);
  });
});
