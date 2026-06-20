"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/glot/icon";
import { cn } from "@/lib/utils";
import { cardsApi, type Card } from "@/lib/api/cards";
import { decksApi, type Deck } from "@/lib/api/decks";
import { readCardMeta } from "@/lib/cards/meta";
import { CardExample, CardGrammar, CardPhonetic } from "./card-meta-details";
import { getSessionProgress } from "./session-progress";
import { advanceQueue, shouldRequeue, type Rating } from "./session-queue";
import { clearSessionSeed, getOrCreateSessionSeed } from "./session-seed";

const ratingButtons = [
  { label: "Again", rating: 1, shortcut: "1", description: "Retry soon", tone: "bad" as const },
  { label: "Hard", rating: 2, shortcut: "2", description: "Still hard", tone: "warn" as const },
  { label: "Good", rating: 3, shortcut: "3", description: "Got it", tone: "accent" as const },
  { label: "Easy", rating: 4, shortcut: "4", description: "Too easy", tone: "info" as const },
];

const TONE_VARS: Record<string, { bg: string; fg: string; border: string }> = {
  bad: { bg: "var(--bad)", fg: "#fff", border: "var(--bad)" },
  warn: { bg: "var(--warn)", fg: "#1a1709", border: "var(--warn)" },
  accent: { bg: "var(--accent)", fg: "var(--accent-fg)", border: "var(--accent)" },
  info: { bg: "var(--info)", fg: "#0a0a0b", border: "var(--info)" },
};

function parseDeckId(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function formatContent(value: string): string {
  return value.trim() || "Untitled card";
}

export default function SessionPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const deckId = parseDeckId(searchParams.get("deck_id"));

  // Cards are held in an explicit ordered queue; the head (index 0) is shown.
  // A failed card is requeued behind the head, so the queue can outlive a
  // single pass over the loaded cards (see session-queue.ts).
  const [queue, setQueue] = useState<Card[]>([]);
  const [decks, setDecks] = useState<Deck[]>([]);
  const [isFlipped, setIsFlipped] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sessionTotal, setSessionTotal] = useState(0);
  // Distinct cards passed out of the session. Requeued cards are not counted
  // until they finally get a passing rating, so progress never overflows.
  const [completedCount, setCompletedCount] = useState(0);
  const [startedAt, setStartedAt] = useState<number>(() => Date.now());
  const isSubmittingRef = useRef(false);

  const currentCard = queue[0];
  const currentMeta = useMemo(() => readCardMeta(currentCard?.meta_data), [currentCard]);
  const deckById = useMemo(() => new Map(decks.map((deck) => [deck.id, deck])), [decks]);
  const currentDeck = currentCard?.deck_id ? deckById.get(currentCard.deck_id) : undefined;
  const { cardNumber, totalCards, progressPercent, estimatedMinutes } = getSessionProgress({
    sessionTotal,
    reviewedCount: completedCount,
    hasCurrentCard: Boolean(currentCard),
  });

  const loadSession = useCallback(async () => {
    setLoading(true);
    setError(null);
    setIsFlipped(false);
    setSessionTotal(0);
    setCompletedCount(0);
    setIsSubmitting(false);
    isSubmittingRef.current = false;

    try {
      // Reuse a stable per-session seed so an interrupted session (reload, tab
      // close) resumes in the same order rather than reshuffling. Scoped per
      // deck (and mixed review) so switching scopes gets its own order.
      const seed = getOrCreateSessionSeed(window.localStorage, deckId);
      const [dueCards, allDecks] = await Promise.all([
        cardsApi.getDueCards({ deck_id: deckId, limit: 100, seed }),
        decksApi.listDecks(),
      ]);
      setQueue(dueCards);
      setDecks(allDecks);
      setSessionTotal(dueCards.length);
      setStartedAt(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load review session");
    } finally {
      setLoading(false);
    }
  }, [deckId]);

  useEffect(() => {
    void loadSession();
  }, [loadSession]);

  useEffect(() => {
    // Once the loaded cards are all worked through, the logical session is over,
    // so drop the seed and let the next session pick a fresh order. Guard on
    // loading/error: a transient empty queue during a (re)load or after a failed
    // fetch must not clear a seed an in-progress session still needs.
    if (loading || error) return;
    if (queue.length === 0) {
      clearSessionSeed(window.localStorage, deckId);
    }
  }, [loading, error, queue.length, deckId]);

  const handleFlip = useCallback(() => {
    if (!currentCard || isAnimating || isSubmitting) return;

    setIsAnimating(true);
    setIsFlipped((flipped) => !flipped);
    window.setTimeout(() => setIsAnimating(false), 300);
  }, [currentCard, isAnimating, isSubmitting]);

  const handleRate = useCallback(
    async (rating: Rating) => {
      if (!currentCard || isSubmittingRef.current) return;

      isSubmittingRef.current = true;
      setIsSubmitting(true);
      setError(null);
      try {
        // Exactly one review is recorded per rating, even for requeued cards.
        await cardsApi.reviewCard(currentCard.id, {
          rating,
          review_duration_ms: Date.now() - startedAt,
        });

        // Passing ratings drop the card and advance progress; a failed card is
        // reinserted later in the queue and does not count as completed yet.
        setQueue((existingQueue) => advanceQueue(existingQueue, rating));
        if (!shouldRequeue(rating)) {
          setCompletedCount((count) => Math.min(count + 1, sessionTotal));
        }
        setIsFlipped(false);
        setStartedAt(Date.now());
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to submit review");
      } finally {
        isSubmittingRef.current = false;
        setIsSubmitting(false);
      }
    },
    [currentCard, sessionTotal, startedAt]
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      if (e.code === "Space") {
        e.preventDefault();
        handleFlip();
        return;
      }

      if (isFlipped) {
        const button = ratingButtons.find((candidate) => candidate.shortcut === e.key);
        if (button) void handleRate(button.rating as 1 | 2 | 3 | 4);
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleFlip, handleRate, isFlipped]);

  const deckName = currentDeck?.name ?? (deckId ? "Selected deck" : "Mixed review");

  return (
    <div className="h-full min-h-0 -m-4 flex flex-col md:-m-6 lg:-m-8" style={{ background: "var(--bg)" }}>
      <header
        className="sticky top-0 z-30"
        style={{
          background: "color-mix(in oklab, var(--bg) 92%, transparent)",
          backdropFilter: "blur(14px)",
          WebkitBackdropFilter: "blur(14px)",
          borderBottom: "1px solid var(--line)",
        }}
      >
        <div className="max-w-3xl mx-auto flex items-center justify-between gap-4 px-4 md:px-6 h-14">
          <Button variant="ghost" size="sm" className="gap-2" onClick={() => router.back()}>
            <Icon name="close" size={14} />
            <span className="hidden sm:inline">Exit</span>
          </Button>

          <div className="flex items-center gap-4">
            <div className="mono" style={{ fontSize: 12, color: "var(--muted)", letterSpacing: "0.04em" }}>
              <span style={{ color: "var(--fg)", fontWeight: 600 }}>{String(cardNumber).padStart(2, "0")}</span>
              <span style={{ color: "var(--line-2)", margin: "0 6px" }}>/</span>
              <span>{String(totalCards).padStart(2, "0")}</span>
            </div>
            <div className="hidden sm:flex items-center gap-1.5" style={{ fontSize: 11, color: "var(--muted)" }}>
              <Icon name="clock" size={12} />
              <span className="mono">~{estimatedMinutes}m</span>
            </div>
          </div>

          <div className="flex gap-1">
            <Button variant="ghost" size="icon" aria-label="Refresh session" onClick={loadSession} disabled={loading || isSubmitting}>
              <Icon name="arrowU" size={15} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Edit card"
              disabled={!currentCard?.deck_id}
              onClick={() => currentCard?.deck_id && router.push(`/decks/${currentCard.deck_id}`)}
            >
              <Icon name="edit" size={15} />
            </Button>
          </div>
        </div>

        <div style={{ height: 2, background: "var(--surface-1)" }}>
          <div
            style={{
              height: "100%",
              width: `${progressPercent}%`,
              background: "var(--accent)",
              transition: "width .35s ease",
              boxShadow: "0 0 10px var(--accent-glow)",
            }}
          />
        </div>
      </header>

      <main className="flex-1 flex flex-col">
        <div className="max-w-3xl mx-auto w-full px-4 md:px-6 pt-8 md:pt-12 text-center">
          <span className="pill outline" style={{ display: "inline-flex" }}>
            <Icon name="layers" size={11} />
            {deckName}
          </span>
        </div>

        <div className="flex-1 flex items-center justify-center px-4 md:px-6 py-10">
          {loading ? (
            <div className="glot-card w-full max-w-2xl p-10 text-center" style={{ background: "var(--surface)" }}>
              <p className="mono" style={{ color: "var(--muted)", letterSpacing: "0.12em" }}>LOADING SESSION</p>
            </div>
          ) : error ? (
            <div className="glot-card w-full max-w-2xl p-10 text-center" style={{ background: "var(--surface)" }}>
              <p className="mono mb-4" style={{ color: "var(--bad)", letterSpacing: "0.12em" }}>SESSION ERROR</p>
              <p className="serif mb-6" style={{ color: "var(--fg)", fontSize: 22 }}>{error}</p>
              <Button onClick={loadSession}>Try again</Button>
            </div>
          ) : !currentCard ? (
            <div className="glot-card w-full max-w-2xl p-10 text-center" style={{ background: "var(--surface)" }}>
              <p className="mono mb-4" style={{ color: "var(--accent)", letterSpacing: "0.12em" }}>ALL CAUGHT UP</p>
              <h2 className="serif mb-3" style={{ color: "var(--fg)", fontSize: 36 }}>No cards due right now.</h2>
              <p className="mb-6" style={{ color: "var(--muted)" }}>Add new cards or come back when more reviews are scheduled.</p>
              <Button onClick={() => router.push("/decks")}>Back to decks</Button>
            </div>
          ) : (
            <div
              className={cn("perspective-1000 w-full max-w-2xl", !isFlipped && "cursor-pointer")}
              onClick={!isFlipped ? handleFlip : undefined}
              role={!isFlipped ? "button" : undefined}
              aria-label={!isFlipped ? "Flip card" : undefined}
            >
              <div className={cn("relative w-full preserve-3d transition-transform duration-300", isFlipped && "rotate-y-180")} style={{ minHeight: "clamp(260px, 40vh, 420px)" }}>
                <div className="absolute inset-0 backface-hidden glot-card flex flex-col items-center justify-center p-10 text-center" style={{ background: "var(--surface)", boxShadow: "0 30px 80px -40px rgba(0,0,0,0.4)" }}>
                  <div className="mono mb-6" style={{ fontSize: 11, color: "var(--muted-2)", letterSpacing: "0.16em" }}>QUESTION</div>
                  <h2 className="serif" style={{ fontSize: "clamp(36px, 6vw, 64px)", fontWeight: 500, lineHeight: 1.1, letterSpacing: "-0.03em", color: "var(--fg)" }}>
                    {formatContent(currentCard.front_content)}
                  </h2>
                  {currentMeta.phonetics ? (
                    <div style={{ marginTop: 16 }}>
                      <CardPhonetic meta={currentMeta} size={16} />
                    </div>
                  ) : null}
                  <div className="mt-auto pt-8 mono flex items-center justify-center gap-2" style={{ fontSize: 11, color: "var(--muted)", letterSpacing: "0.08em" }}>
                    <span className="touch-only">TAP TO FLIP</span>
                    <span className="kbd-only">TAP OR PRESS <kbd>SPACE</kbd></span>
                  </div>
                </div>

                <div className="absolute inset-0 backface-hidden rotate-y-180 glot-card flex flex-col items-center justify-center p-10 text-center" style={{ background: "var(--surface)", borderColor: "color-mix(in oklab, var(--accent) 35%, var(--line))", boxShadow: "0 30px 80px -40px var(--accent-glow)" }}>
                  <div className="mono mb-4" style={{ fontSize: 11, color: "var(--accent)", letterSpacing: "0.16em" }}>ANSWER</div>
                  <h3 className="serif" style={{ fontSize: 28, fontWeight: 500, color: "var(--accent)", marginBottom: 8 }}>
                    {formatContent(currentCard.front_content)}
                  </h3>
                  <CardGrammar meta={currentMeta} />
                  <p className="serif whitespace-pre-line max-w-xl" style={{ fontSize: 19, lineHeight: 1.5, color: "var(--fg)", fontWeight: 400, marginTop: 16 }}>
                    {formatContent(currentCard.back_content)}
                  </p>
                  <CardExample meta={currentMeta} />
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="px-4 md:px-6 pb-8 pt-4" style={{ borderTop: "1px solid var(--line)", background: "var(--bg-1)", position: "relative", zIndex: 10 }}>
          <div className="max-w-2xl mx-auto">
            {currentCard && isFlipped ? (
              <>
                <div className="mono text-center mb-3" style={{ fontSize: 10, color: "var(--muted-2)", letterSpacing: "0.16em" }}>RATE YOUR RECALL</div>
                <div className="grid grid-cols-4 gap-2">
                  {ratingButtons.map((btn) => {
                    const tone = TONE_VARS[btn.tone];
                    return (
                      <button
                        key={btn.label}
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleRate(btn.rating as 1 | 2 | 3 | 4);
                        }}
                        disabled={isSubmitting}
                        className="focus-glow"
                        style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2, padding: "14px 8px", borderRadius: "var(--radius)", background: tone.bg, color: tone.fg, border: `1px solid ${tone.border}`, cursor: isSubmitting ? "wait" : "pointer", fontWeight: 600, opacity: isSubmitting ? 0.7 : 1 }}
                      >
                        <span style={{ fontSize: 14 }}>{btn.label}</span>
                        <span className="mono" style={{ fontSize: 10, opacity: 0.75, letterSpacing: "0.04em" }}>{btn.description}</span>
                        <kbd className="kbd-only" style={{ marginTop: 4, background: "rgba(0,0,0,0.15)", color: "inherit", border: "1px solid rgba(0,0,0,0.15)" }}>{btn.shortcut}</kbd>
                      </button>
                    );
                  })}
                </div>
              </>
            ) : currentCard ? (
              <div className="flex justify-center">
                <Button size="lg" className="px-12 gap-2" onClick={handleFlip} disabled={isSubmitting}>
                  Show answer
                  <kbd className="kbd-only" style={{ background: "rgba(0,0,0,0.15)", color: "inherit", border: "1px solid rgba(0,0,0,0.2)" }}>SPACE</kbd>
                </Button>
              </div>
            ) : null}
          </div>
        </div>
      </main>
    </div>
  );
}
