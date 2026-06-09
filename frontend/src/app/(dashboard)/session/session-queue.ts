/**
 * Study-session queue helpers.
 *
 * The session keeps an explicit ordered queue of cards in memory. The card at
 * the head of the queue (index 0) is the one currently shown. Rating a card
 * either removes it from the session (a passing rating) or requeues it later in
 * the same session so the user gets another attempt before the session ends.
 *
 * These helpers are pure so they can be unit-tested without a DOM environment.
 */

export type Rating = 1 | 2 | 3 | 4;

/**
 * Ratings that requeue a card within the active session.
 *
 * Defaults to Again (1) only. Hard (2) is intentionally excluded: requeuing a
 * card the user got right (just slowly) feels punishing and bloats the session.
 * Add ratings here to change the default; the rest of the queue logic adapts.
 */
export const REQUEUE_RATINGS: readonly Rating[] = [1];

/**
 * How many cards to skip before a requeued card reappears. The card is
 * reinserted this many positions behind the head, or at the end of the queue
 * if fewer cards remain.
 */
export const REQUEUE_GAP = 3;

/** Whether a rating causes the current card to reappear later this session. */
export function shouldRequeue(rating: Rating): boolean {
  return REQUEUE_RATINGS.includes(rating);
}

/**
 * Apply a rating to the head card of an ordered session queue and return the
 * next queue.
 *
 * - A passing rating removes the head card from the session.
 * - A requeue rating (see {@link REQUEUE_RATINGS}) reinserts the head card
 *   `gap` positions back, or at the end of the queue when fewer cards remain,
 *   so it is seen again before the session finishes.
 *
 * The input queue is not mutated.
 */
export function advanceQueue<T>(
  queue: readonly T[],
  rating: Rating,
  gap: number = REQUEUE_GAP,
): T[] {
  if (queue.length === 0) return [];

  const [head, ...rest] = queue;

  if (!shouldRequeue(rating)) {
    return rest;
  }

  const insertAt = Math.min(Math.max(0, gap), rest.length);
  return [...rest.slice(0, insertAt), head, ...rest.slice(insertAt)];
}
