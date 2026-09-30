/**
 * Per-logical-session RNG seed for stable due-card ordering.
 *
 * The `/cards/due/batch` endpoint accepts an optional `seed` that fixes the
 * presentation order: with the same selected due-card set, the same seed
 * yields the same order. We generate a seed once per logical session and
 * persist it in browser storage, so an interruption (reload, tab close,
 * navigation) resumes the session in the same order instead of reshuffling.
 *
 * The seed is scoped per user and per scope (a deck-specific session vs the
 * mixed-review session), so switching scopes — or accounts on a shared
 * device — never reuses a stale order. It is cleared once the scope is
 * confirmed empty, so the next session starts fresh.
 *
 * These helpers are pure (storage and the RNG are injectable) so they can be
 * unit-tested without a DOM environment. Storage access is always guarded:
 * private-browsing modes can throw on any operation; when storage is
 * unusable an in-memory fallback keeps the page's order stable (it just
 * cannot survive a reload).
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

/** In-memory fallback used when storage is missing or throws. */
const memorySeeds = new Map<string, number>();

/**
 * Browser-storage key for a session scope. `deckId` identifies a deck-specific
 * session; `undefined` is the mixed-review session. Keying by user stops
 * accounts on a shared device from sharing an order.
 */
export function sessionSeedKey(userId: number, deckId: number | undefined): string {
  return `${SEED_KEY_PREFIX}u${userId}:${deckId ?? "mixed"}`;
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

function parseStoredSeed(raw: string | null): number | null {
  if (raw === null) return null;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > MAX_SEED) return null;
  return parsed;
}

/**
 * Return the persisted seed for this scope, or create, store, and return a new
 * one. Reusing the stored seed across reloads is what keeps an interrupted
 * session's order stable; a missing or corrupt value is replaced.
 *
 * `storage` may be null when browser storage is entirely unavailable; the
 * in-memory fallback then keeps the order stable for this page's lifetime.
 */
export function getOrCreateSessionSeed(
  storage: SeedStorage | null,
  userId: number,
  deckId: number | undefined,
  generate: () => number = randomSeed,
): number {
  const key = sessionSeedKey(userId, deckId);

  let stored: string | null = null;
  let storageBroken = storage === null;
  if (storage && !storageBroken) {
    try {
      stored = storage.getItem(key);
    } catch {
      storageBroken = true;
    }
  }

  if (!storageBroken) {
    const existing = parseStoredSeed(stored);
    if (existing !== null) {
      memorySeeds.set(key, existing);
      return existing;
    }

    const seed = generate();
    memorySeeds.set(key, seed);
    try {
      storage!.setItem(key, String(seed));
    } catch {
      // Storage turned read-only mid-session; the memory fallback keeps this
      // page's order stable.
    }
    return seed;
  }

  // Storage unusable: keep a stable per-page seed instead of reshuffling on
  // every call.
  const fallback = memorySeeds.get(key);
  if (fallback !== undefined) return fallback;

  const seed = generate();
  memorySeeds.set(key, seed);
  return seed;
}

/**
 * Drop the stored seed for this scope so the next session in the same scope
 * starts from a fresh order. Call this only when the scope is genuinely
 * finished (confirmed empty), never for a transient empty queue.
 */
export function clearSessionSeed(
  storage: SeedStorage | null,
  userId: number,
  deckId: number | undefined,
): void {
  const key = sessionSeedKey(userId, deckId);
  memorySeeds.delete(key);
  if (!storage) return;
  try {
    storage.removeItem(key);
  } catch {
    // Nothing else to clean up.
  }
}
