export type SessionProgress = {
  /** Cards still to get through, from the server's authoritative count. */
  remaining: number;
  /** Distinct cards passed so far in this session. */
  completed: number;
  progressPercent: number;
  estimatedMinutes: number;
};

/**
 * Session display math.
 *
 * `remaining` is the server's truth (same computation as the dashboard), so
 * progress is `completed / (completed + remaining)`. The ratio can move
 * backward when new work appears mid-session (cards becoming due, a batch
 * boundary); that is intended — the display stays factual rather than only
 * ever moving forward.
 */
export function getSessionProgress({
  remaining,
  completed,
  hasCurrentCard,
}: {
  remaining: number | null;
  completed: number;
  hasCurrentCard: boolean;
}): SessionProgress {
  const remainingCount = Math.max(0, remaining ?? 0);
  const done = Math.max(0, completed);
  const totalUnits = done + remainingCount;

  let progressPercent = 0;
  if (totalUnits > 0) {
    progressPercent = (done / totalUnits) * 100;
  } else if (!hasCurrentCard && done > 0) {
    progressPercent = 100;
  }

  return {
    remaining: remainingCount,
    completed: done,
    progressPercent: Math.min(100, progressPercent),
    estimatedMinutes: Math.max(1, Math.round(remainingCount * 0.25)),
  };
}
