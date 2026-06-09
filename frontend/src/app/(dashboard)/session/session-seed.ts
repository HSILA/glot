/**
 * Per-logical-session RNG seed for stable due-card ordering.
 *
 * The `/cards/due` endpoint accepts an optional `seed` that fixes the
 * presentation order: with the same selected due-card set, the same seed yields
 * the same order. We generate a seed once per logical session and persist it in
 * browser storage, so an interruption (reload, tab close, navigation) resumes
 * the session in the same order instead of reshuffling.
 *
 * The seed is scoped: a deck-specific session and a mixed-review session must
 * not share a seed, otherwise switching scopes would reuse a stale order.
 *
 * These helpers are pure (storage and the RNG are injectable) so they can be
 * unit-tested without a DOM environment, matching the other session helpers.
 */

/** The subset of the Web Storage API the seed helpers use. Browser storage
 * (`window.localStorage` in production) and a test fake satisfy it. */
export type SeedStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const SEED_KEY_PREFIX = "glot:session-seed:";

/**
 * Largest seed we generate: 2^31 - 1. This stays a safe JS integer (well under
 * `Number.MAX_SAFE_INTEGER`) and within a signed 32-bit range, so it survives
 * the round-trip to the backend `int` unchanged regardless of how it is stored.
 */
export const MAX_SEED = 0x7fffffff;

/**
 * Browser-storage key for a session scope. `deckId` identifies a deck-specific
 * session; `undefined` is the mixed-review session. Keeping the scope in the key
 * is what stops the two from sharing a seed.
 */
export function sessionSeedKey(deckId: number | undefined): string {
  return `${SEED_KEY_PREFIX}${deckId ?? "mixed"}`;
}

/**
 * A browser-safe random seed in `[0, MAX_SEED]`.
 *
 * Uses the Web Crypto RNG; masking off the high bit maps any 32-bit value into
 * the signed range without modulo bias.
 */
export function randomSeed(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] & MAX_SEED;
}

/**
 * Return the persisted seed for this scope, or create, store, and return a new
 * one. Reusing the stored seed across reloads is what keeps an interrupted
 * session's order stable; a missing or corrupt value is replaced.
 */
export function getOrCreateSessionSeed(
  storage: SeedStorage,
  deckId: number | undefined,
  generate: () => number = randomSeed,
): number {
  const key = sessionSeedKey(deckId);
  const stored = storage.getItem(key);
  if (stored !== null) {
    const parsed = Number(stored);
    if (Number.isInteger(parsed) && parsed >= 0 && parsed <= MAX_SEED) return parsed;
  }

  const seed = generate();
  storage.setItem(key, String(seed));
  return seed;
}

/**
 * Drop the stored seed for this scope so the next session in the same scope
 * starts from a fresh order. Call this only when the session genuinely finishes.
 */
export function clearSessionSeed(storage: SeedStorage, deckId: number | undefined): void {
  storage.removeItem(sessionSeedKey(deckId));
}
