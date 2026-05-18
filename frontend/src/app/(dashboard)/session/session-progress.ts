export type SessionProgress = {
  cardNumber: number;
  totalCards: number;
  progressPercent: number;
  remaining: number;
  estimatedMinutes: number;
};

export function getSessionProgress({
  sessionTotal,
  reviewedCount,
  hasCurrentCard,
}: {
  sessionTotal: number;
  reviewedCount: number;
  hasCurrentCard: boolean;
}): SessionProgress {
  const totalCards = Math.max(0, sessionTotal);
  const completed = Math.min(Math.max(0, reviewedCount), totalCards);

  if (totalCards === 0) {
    return {
      cardNumber: 0,
      totalCards: 0,
      progressPercent: 0,
      remaining: 0,
      estimatedMinutes: 1,
    };
  }

  const remaining = hasCurrentCard ? totalCards - completed : 0;
  const cardNumber = hasCurrentCard ? Math.min(completed + 1, totalCards) : totalCards;
  const progressPosition = hasCurrentCard ? cardNumber : totalCards;

  return {
    cardNumber,
    totalCards,
    progressPercent: (progressPosition / totalCards) * 100,
    remaining,
    estimatedMinutes: Math.max(1, Math.round(remaining * 0.25)),
  };
}
