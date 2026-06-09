/**
 * Tests for the review-card language-metadata helpers.
 *
 * Run with: `bun test src/lib/cards/meta.test.ts`
 */

import { describe, expect, test } from "bun:test";

import {
  classifyGender,
  hasCardMeta,
  hasGrammarMeta,
  readCardMeta,
  splitHighlight,
} from "./meta";

describe("readCardMeta", () => {
  test("maps snake_case backend keys to the typed shape", () => {
    const meta = readCardMeta({
      phonetics: "/ʃa/",
      word_type: "noun",
      gender: "masculine",
      example: "Le chat dort.",
      example_translation: "The cat sleeps.",
      example_highlight: "chat",
    });

    expect(meta).toEqual({
      phonetics: "/ʃa/",
      wordType: "noun",
      gender: "masculine",
      example: "Le chat dort.",
      exampleTranslation: "The cat sleeps.",
      exampleHighlight: "chat",
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

describe("hasCardMeta / hasGrammarMeta", () => {
  test("hasCardMeta is false when no recognized fields are present", () => {
    expect(hasCardMeta(readCardMeta({}))).toBe(false);
    expect(hasCardMeta(readCardMeta({ reading: "ねこ" }))).toBe(false);
  });

  test("hasCardMeta is true when at least one recognized field is present", () => {
    expect(hasCardMeta(readCardMeta({ gender: "feminine" }))).toBe(true);
    expect(hasCardMeta(readCardMeta({ example: "Le chat dort." }))).toBe(true);
  });

  test("hasGrammarMeta only considers phonetics/type/gender", () => {
    expect(hasGrammarMeta(readCardMeta({ phonetics: "/ʃa/" }))).toBe(true);
    expect(hasGrammarMeta(readCardMeta({ word_type: "noun" }))).toBe(true);
    expect(hasGrammarMeta(readCardMeta({ gender: "fem" }))).toBe(true);
    // Example-only metadata is not a grammatical detail.
    expect(hasGrammarMeta(readCardMeta({ example: "Le chat dort." }))).toBe(false);
  });
});

describe("classifyGender", () => {
  test("recognizes masculine forms and abbreviations", () => {
    for (const v of ["m", "masc", "masculine", "der", "MASCULIN"]) {
      expect(classifyGender(v)).toBe("masculine");
    }
  });

  test("recognizes feminine and neuter forms", () => {
    expect(classifyGender("f")).toBe("feminine");
    expect(classifyGender("Feminine")).toBe("feminine");
    expect(classifyGender("neuter")).toBe("neuter");
    expect(classifyGender("das")).toBe("neuter");
  });

  test("falls back to 'other' for unrecognized values", () => {
    expect(classifyGender("common")).toBe("other");
    expect(classifyGender("animate")).toBe("other");
  });
});

describe("splitHighlight", () => {
  test("returns one plain segment when no term is given", () => {
    expect(splitHighlight("Le chat dort.")).toEqual([
      { text: "Le chat dort.", highlight: false },
    ]);
  });

  test("marks a case-insensitive occurrence of the term", () => {
    expect(splitHighlight("Le Chat dort.", "chat")).toEqual([
      { text: "Le ", highlight: false },
      { text: "Chat", highlight: true },
      { text: " dort.", highlight: false },
    ]);
  });

  test("marks every occurrence", () => {
    expect(splitHighlight("aube et aube", "aube")).toEqual([
      { text: "aube", highlight: true },
      { text: " et ", highlight: false },
      { text: "aube", highlight: true },
    ]);
  });

  test("returns the original text when the term is not found", () => {
    expect(splitHighlight("Le chat dort.", "zzz")).toEqual([
      { text: "Le chat dort.", highlight: false },
    ]);
  });
});
