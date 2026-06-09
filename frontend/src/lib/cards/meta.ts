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
  /** Grammatical gender, e.g. masculine, feminine, neuter. */
  gender?: string;
  /** Example sentence using the word/phrase. */
  example?: string;
  /** Translation of the example sentence. */
  exampleTranslation?: string;
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

  if (phonetics) result.phonetics = phonetics;
  if (wordType) result.wordType = wordType;
  if (gender) result.gender = gender;
  if (example) result.example = example;
  if (exampleTranslation) result.exampleTranslation = exampleTranslation;

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
