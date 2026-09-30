"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/glot/icon";
import { useAuth } from "@/components/providers/auth-provider";
import { cn } from "@/lib/utils";
import { cardsApi } from "@/lib/api/cards";
import { decksApi } from "@/lib/api/decks";
import { readCardMeta } from "@/lib/cards/meta";
import { CardExample, CardGrammar, CardPhonetic } from "./card-meta-details";
import { getSessionProgress } from "./session-progress";
import type { Rating } from "./session-queue";
import { SessionController, type SessionState } from "./session-controller";
import { createDefaultOutboxStorage, ReviewOutbox } from "./review-outbox";
import { clearSessionSeed, getOrCreateSessionSeed, type SeedStorage } from "./session-seed";

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

const INITIAL_STATE: SessionState = {
  phase: "loading",
  queue: [],
  remaining: null,
  completed: 0,
  pendingRetry: null,
  notice: null,
  error: null,
  durabilityDegraded: false,
};

function parseDeckId(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function formatContent(value: string): string {
  return value.trim() || "Untitled card";
}

function getLocalStorage(): SeedStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export default function SessionPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const deckId = parseDeckId(searchParams.get("deck_id"));
  const { user } = useAuth();
  const userId = user?.id;

  const [session, setSession] = useState<SessionState>(INITIAL_STATE);
  const [deckNames, setDeckNames] = useState<Map<number, string>>(new Map());
  // The flip belongs to a specific card id: a card is face-up only while its
  // own id is the current head, so advancing the queue resets the flip
  // without needing an effect.
  const [flippedId, setFlippedId] = useState<number | null>(null);
  const [isAnimating, setIsAnimating] = useState(false);
  const controllerRef = useRef<SessionController | null>(null);

  const currentCard = session.queue[0];
  const isFlipped = currentCard !== undefined && flippedId === currentCard.id;
  const currentMeta = useMemo(() => readCardMeta(currentCard?.meta_data), [currentCard]);
  const { progressPercent, estimatedMinutes } = getSessionProgress({
    remaining: session.remaining,
    completed: session.completed,
    hasCurrentCard: Boolean(currentCard),
  });

  // One controller per (user, scope). It owns batch loading, the truthful
  // count, and retry-safe submissions; the page just renders its state.
  useEffect(() => {
    if (userId === undefined) return;

    const controller = new SessionController({
      scope: { userId, deckId },
      api: cardsApi,
      outbox: new ReviewOutbox(createDefaultOutboxStorage()),
      getSeed: () => getOrCreateSessionSeed(getLocalStorage(), userId, deckId),
      clearSeed: () => clearSessionSeed(getLocalStorage(), userId, deckId),
      onState: setSession,
    });
    controllerRef.current = controller;
    void controller.start();

    return () => {
      controller.dispose();
      controllerRef.current = null;
    };
  }, [userId, deckId]);

  // Reconcile pending work and refresh the count when the tab returns to the
  // foreground (phone unlocked, tab re-focused, restored from bfcache).
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        void controllerRef.current?.handleResume();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", onVisible);
    };
  }, []);

  const handleFlip = useCallback(() => {
    if (!currentCard || isAnimating || session.phase !== "active") return;

    setIsAnimating(true);
    setFlippedId((flippedFor) => (flippedFor === currentCard.id ? null : currentCard.id));
    window.setTimeout(() => setIsAnimating(false), 300);
  }, [currentCard, isAnimating, session.phase]);

  // Keep the answer visible when a submission still needs settling (the
  // visible card is still the one being retried); otherwise move on to the
  // next card face-down.
  const runSessionAction = useCallback(async (action: () => Promise<void> | undefined) => {
    await action();
    const controller = controllerRef.current;
    if (!controller || !controller.getState().pendingRetry) {
      setFlippedId(null);
    }
  }, []);

  const handleRate = useCallback(
    (rating: Rating) => runSessionAction(() => controllerRef.current?.rate(rating)),
    [runSessionAction],
  );

  const handleRetry = useCallback(
    () => void runSessionAction(() => controllerRef.current?.retryPending()),
    [runSessionAction],
  );

  const handleRefresh = useCallback(() => {
    setFlippedId(null);
    void controllerRef.current?.refresh();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      if (e.code === "Space") {
        e.preventDefault();
        handleFlip();
        return;
      }

      if (isFlipped && session.phase === "active" && !session.pendingRetry) {
        const button = ratingButtons.find((candidate) => candidate.shortcut === e.key);
        if (button) void handleRate(button.rating as Rating);
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleFlip, handleRate, isFlipped, session.phase, session.pendingRetry]);

  // Deck name for the pill: fetched lazily for the deck(s) actually shown,
  // instead of loading the full deck list just for a label.
  const deckIdToShow = currentCard?.deck_id ?? deckId;
  useEffect(() => {
    if (deckIdToShow === undefined) return;
    if (deckNames.has(deckIdToShow)) return;

    let cancelled = false;
    void decksApi
      .getDeck(deckIdToShow)
      .then((deck) => {
        if (!cancelled) {
          setDeckNames((previous) => new Map(previous).set(deck.id, deck.name));
        }
      })
      .catch(() => {
        // The pill falls back to a generic label; not worth a visible error.
      });
    return () => {
      cancelled = true;
    };
  }, [deckIdToShow, deckNames]);

  const deckName =
    (deckIdToShow !== undefined ? deckNames.get(deckIdToShow) : undefined) ??
    (deckId !== undefined ? "Selected deck" : "Mixed review");

  const showCard = session.queue.length > 0;
  const ratingsEnabled = session.phase === "active" && !session.pendingRetry;
  const remainingLabel = session.remaining === null ? "–" : String(session.remaining);

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
            <div
              className="mono"
              style={{ fontSize: 12, color: "var(--muted)", letterSpacing: "0.04em" }}
              title="Cards remaining in this session"
            >
              <span style={{ color: "var(--fg)", fontWeight: 600 }}>{remainingLabel}</span>
              <span style={{ color: "var(--line-2)", margin: "0 6px" }}>·</span>
              <span>left</span>
            </div>
            {session.remaining !== null && session.remaining > 0 ? (
              <div className="hidden sm:flex items-center gap-1.5" style={{ fontSize: 11, color: "var(--muted)" }}>
                <Icon name="clock" size={12} />
                <span className="mono">~{estimatedMinutes}m</span>
              </div>
            ) : null}
          </div>

          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Refresh session"
              onClick={handleRefresh}
              disabled={session.phase !== "active" && session.phase !== "exhausted"}
            >
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
          {session.phase === "loading" ? (
            <div className="glot-card w-full max-w-2xl p-10 text-center" style={{ background: "var(--surface)" }}>
              <p className="mono" style={{ color: "var(--muted)", letterSpacing: "0.12em" }}>LOADING SESSION</p>
            </div>
          ) : session.phase === "error" ? (
            <div className="glot-card w-full max-w-2xl p-10 text-center" style={{ background: "var(--surface)" }}>
              <p className="mono mb-4" style={{ color: "var(--bad)", letterSpacing: "0.12em" }}>SESSION ERROR</p>
              <p className="serif mb-6" style={{ color: "var(--fg)", fontSize: 22 }}>{session.error}</p>
              <Button onClick={handleRefresh}>Try again</Button>
            </div>
          ) : session.phase === "exhausted" ? (
            <div className="glot-card w-full max-w-2xl p-10 text-center" style={{ background: "var(--surface)" }}>
              <p className="mono mb-4" style={{ color: "var(--accent)", letterSpacing: "0.12em" }}>ALL CAUGHT UP</p>
              <h2 className="serif mb-3" style={{ color: "var(--fg)", fontSize: 36 }}>No cards due right now.</h2>
              <p className="mb-6" style={{ color: "var(--muted)" }}>Add new cards or come back when more reviews are scheduled.</p>
              <Button onClick={() => router.push("/decks")}>Back to decks</Button>
            </div>
          ) : !showCard ? (
            <div className="glot-card w-full max-w-2xl p-10 text-center" style={{ background: "var(--surface)" }}>
              <p className="mono" style={{ color: "var(--muted)", letterSpacing: "0.12em" }}>LOADING NEXT CARDS</p>
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
            {session.error && session.phase === "active" ? (
              <div className="mono text-center mb-3" style={{ fontSize: 11, color: "var(--bad)", letterSpacing: "0.04em" }}>
                {session.error}
              </div>
            ) : null}
            {session.notice && !session.pendingRetry ? (
              <div className="mono text-center mb-3" style={{ fontSize: 11, color: "var(--muted)", letterSpacing: "0.04em" }}>
                {session.notice}
              </div>
            ) : null}
            {session.durabilityDegraded && !session.pendingRetry ? (
              <div className="mono text-center mb-3" style={{ fontSize: 10, color: "var(--muted-2)", letterSpacing: "0.06em" }}>
                OFFLINE STORAGE UNAVAILABLE — RETRY PROTECTION LIMITED TO THIS TAB
              </div>
            ) : null}
            {showCard && session.pendingRetry ? (
              <div className="glot-card" style={{ background: "var(--surface)", padding: "16px 18px" }}>
                <div className="flex items-center gap-4">
                  <div style={{ flex: 1 }}>
                    <div className="mono" style={{ fontSize: 10, color: "var(--warn)", letterSpacing: "0.16em", marginBottom: 6 }}>
                      RATING NOT CONFIRMED
                    </div>
                    <p style={{ color: "var(--muted)", fontSize: 13, lineHeight: 1.5 }}>
                      The connection dropped while saving. The rating is kept safe and will be sent again with the same
                      id — it cannot be counted twice.
                    </p>
                  </div>
                  <Button onClick={handleRetry} disabled={session.phase === "submitting"}>
                    Retry now
                  </Button>
                </div>
              </div>
            ) : showCard && isFlipped ? (
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
                          void handleRate(btn.rating as Rating);
                        }}
                        disabled={!ratingsEnabled}
                        className="focus-glow"
                        style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2, padding: "14px 8px", borderRadius: "var(--radius)", background: tone.bg, color: tone.fg, border: `1px solid ${tone.border}`, cursor: ratingsEnabled ? "pointer" : "wait", fontWeight: 600, opacity: ratingsEnabled ? 1 : 0.7 }}
                      >
                        <span style={{ fontSize: 14 }}>{btn.label}</span>
                        <span className="mono" style={{ fontSize: 10, opacity: 0.75, letterSpacing: "0.04em" }}>{btn.description}</span>
                        <kbd className="kbd-only" style={{ marginTop: 4, background: "rgba(0,0,0,0.15)", color: "inherit", border: "1px solid rgba(0,0,0,0.15)" }}>{btn.shortcut}</kbd>
                      </button>
                    );
                  })}
                </div>
              </>
            ) : showCard ? (
              <div className="flex justify-center">
                <Button size="lg" className="px-12 gap-2" onClick={handleFlip} disabled={session.phase !== "active"}>
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
