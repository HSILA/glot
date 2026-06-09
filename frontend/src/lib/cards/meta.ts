/**
 * Optional language-learning fields a card may carry inside its free-form
 * `meta_data`. These are surfaced only in the review/session UI and are always
 * optional — a card without them reviews exactly as before.
 *
 * The backend stores these inside the card's `meta_data` JSONB (documented by
 * the `CardMetadata` schema). Mirroring them here keeps the review UI's contract
 * explicit while tolerating arbitrary/legacy metadata shapes.
 */

export interface CardMeta {
  /** Pronunciation / phonetic transcription (e.g. IPA). */
  phonetics?: string;
  /** Part of speech, e.g. noun, verb, adjective, adverb. */
  wordType?: string;
  /** Grammatical gender, e.g. masculine, feminine, neuter (free text). */
  gender?: string;
  /** Example sentence using the word/phrase. */
  example?: string;
  /** Translation of the example sentence. */
  exampleTranslation?: string;
  /** Substring of the example to emphasize (usually the target word). */
  exampleHighlight?: string;
}

/** Read a trimmed, non-empty string field from a metadata bag, else undefined. */
function readString(meta: Record<string, unknown>, key: string): string | undefined {
  const value = meta[key];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Normalize a card's raw `meta_data` into the recognized language-learning
 * fields. Non-string and empty/whitespace values are dropped so the review UI
 * can simply check for presence before rendering a chip/row/section.
 */
export function readCardMeta(meta: Record<string, unknown> | null | undefined): CardMeta {
  if (!meta || typeof meta !== "object") return {};

  const result: CardMeta = {};
  const phonetics = readString(meta, "phonetics");
  const wordType = readString(meta, "word_type");
  const gender = readString(meta, "gender");
  const example = readString(meta, "example");
  const exampleTranslation = readString(meta, "example_translation");
  const exampleHighlight = readString(meta, "example_highlight");

  if (phonetics) result.phonetics = phonetics;
  if (wordType) result.wordType = wordType;
  if (gender) result.gender = gender;
  if (example) result.example = example;
  if (exampleTranslation) result.exampleTranslation = exampleTranslation;
  if (exampleHighlight) result.exampleHighlight = exampleHighlight;

  return result;
}

/** Whether any recognized language-learning field is present. */
export function hasCardMeta(meta: CardMeta): boolean {
  return Boolean(
    meta.phonetics ||
      meta.wordType ||
      meta.gender ||
      meta.example ||
      meta.exampleTranslation,
  );
}

/** Whether any inline grammatical detail (phonetics/type/gender) is present. */
export function hasGrammarMeta(meta: CardMeta): boolean {
  return Boolean(meta.phonetics || meta.wordType || meta.gender);
}

export type GenderTone = "masculine" | "feminine" | "neuter" | "other";

/**
 * Classify a free-text grammatical gender so the UI can pick a consistent
 * accent dot and short label. Accepts common forms and abbreviations
 * (e.g. "m", "masc", "masculine", "der") across a few languages; anything
 * unrecognized falls back to "other" and is displayed verbatim.
 */
export function classifyGender(value: string): GenderTone {
  const v = value.trim().toLowerCase();
  if (/^(m|masc|masculine|masculin|männlich|der|el|il|le)\b/.test(v)) return "masculine";
  if (/^(f|fem|feminine|féminin|weiblich|die|la)\b/.test(v)) return "feminine";
  if (/^(n|neut|neuter|neutral|sächlich|das)\b/.test(v)) return "neuter";
  return "other";
}

export interface HighlightSegment {
  text: string;
  highlight: boolean;
}

/**
 * Split `text` into ordered segments, marking case-insensitive occurrences of
 * `term` for emphasis. Returns a single non-highlighted segment when `term` is
 * empty or not found, so callers can always render the segments directly.
 */
export function splitHighlight(text: string, term?: string): HighlightSegment[] {
  const needle = term?.trim();
  if (!needle) return [{ text, highlight: false }];

  const segments: HighlightSegment[] = [];
  const lowerText = text.toLowerCase();
  const lowerNeedle = needle.toLowerCase();
  let cursor = 0;

  for (;;) {
    const index = lowerText.indexOf(lowerNeedle, cursor);
    if (index === -1) break;
    if (index > cursor) segments.push({ text: text.slice(cursor, index), highlight: false });
    segments.push({ text: text.slice(index, index + needle.length), highlight: true });
    cursor = index + needle.length;
  }

  if (cursor < text.length) segments.push({ text: text.slice(cursor), highlight: false });
  return segments.length > 0 ? segments : [{ text, highlight: false }];
}
