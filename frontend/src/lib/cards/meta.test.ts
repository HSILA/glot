/**
 * Tests for the review-card language-metadata normalizer.
 *
 * Run with: `bun test src/lib/cards/meta.test.ts`
 */

import { describe, expect, test } from "bun:test";

import { hasCardMeta, readCardMeta } from "./meta";

describe("readCardMeta", () => {
  test("maps snake_case backend keys to the typed shape", () => {
    const meta = readCardMeta({
      phonetics: "/ʃa/",
      word_type: "noun",
      gender: "masculine",
      example: "Le chat dort.",
      example_translation: "The cat sleeps.",
    });

    expect(meta).toEqual({
      phonetics: "/ʃa/",
      wordType: "noun",
      gender: "masculine",
      example: "Le chat dort.",
      exampleTranslation: "The cat sleeps.",
    });
  });

  test("returns an empty object for missing/empty metadata", () => {
    expect(readCardMeta({})).toEqual({});
    expect(readCardMeta(null)).toEqual({});
    expect(readCardMeta(undefined)).toEqual({});
  });

  test("drops empty, whitespace, and non-string values", () => {
    const meta = readCardMeta({
      phonetics: "   ",
      word_type: "",
      gender: 42,
      example: null,
      example_translation: "  The cat sleeps.  ",
    });

    expect(meta).toEqual({ exampleTranslation: "The cat sleeps." });
  });

  test("ignores unrelated metadata keys", () => {
    const meta = readCardMeta({ reading: "ねこ", word_type: "noun" });

    expect(meta).toEqual({ wordType: "noun" });
  });
});

describe("hasCardMeta", () => {
  test("is false when no recognized fields are present", () => {
    expect(hasCardMeta(readCardMeta({}))).toBe(false);
    expect(hasCardMeta(readCardMeta({ reading: "ねこ" }))).toBe(false);
  });

  test("is true when at least one recognized field is present", () => {
    expect(hasCardMeta(readCardMeta({ gender: "feminine" }))).toBe(true);
    expect(hasCardMeta(readCardMeta({ phonetics: "/ʃa/" }))).toBe(true);
  });
});
