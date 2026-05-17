"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/glot/icon";
import { cn } from "@/lib/utils";

// Mock card data (preserved from prior implementation)
const mockCard = {
  id: 1,
  front: "Ephemeral",
  back: "Lasting for a very short time; transitory.\n\n'The ephemeral nature of cherry blossoms makes them even more precious.'",
  deckName: "SAT Vocabulary",
  cardNumber: 5,
  totalCards: 23,
};

const ratingButtons = [
  { label: "Again", shortcut: "1", description: "< 1min", tone: "bad" as const },
  { label: "Hard", shortcut: "2", description: "6min", tone: "warn" as const },
  { label: "Good", shortcut: "3", description: "10min", tone: "accent" as const },
  { label: "Easy", shortcut: "4", description: "4d", tone: "info" as const },
];

const TONE_VARS: Record<string, { bg: string; fg: string; border: string }> = {
  bad: { bg: "var(--bad)", fg: "#fff", border: "var(--bad)" },
  warn: { bg: "var(--warn)", fg: "#1a1709", border: "var(--warn)" },
  accent: { bg: "var(--accent)", fg: "var(--accent-fg)", border: "var(--accent)" },
  info: { bg: "var(--info)", fg: "#0a0a0b", border: "var(--info)" },
};

export default function SessionPage() {
  // Preserved: search params for deck filtering (drives mock title for now)
  useSearchParams();

  const [isFlipped, setIsFlipped] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);

  const handleFlip = () => {
    if (!isAnimating) {
      setIsAnimating(true);
      setIsFlipped((f) => !f);
      setTimeout(() => setIsAnimating(false), 300);
    }
  };

  const handleRate = (rating: string) => {
    setIsFlipped(false);
    console.log("Rated:", rating);
  };

  // Keyboard shortcuts (skip when focus is in an input/textarea/select)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.code === "Space") {
        e.preventDefault();
        handleFlip();
      }
      if (isFlipped) {
        const idx = ["1", "2", "3", "4"].indexOf(e.key);
        if (idx >= 0) handleRate(ratingButtons[idx].label);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFlipped, isAnimating]);

  const progressPercent = (mockCard.cardNumber / mockCard.totalCards) * 100;
  const remaining = mockCard.totalCards - mockCard.cardNumber + 1;
  const estimatedMinutes = Math.max(1, Math.round(remaining * 0.25));

  return (
    <div
      className="min-h-screen flex flex-col"
      style={{ background: "var(--bg)" }}
    >
      {/* Sticky header */}
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
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" className="gap-2" onClick={() => window.history.back()}>
              <Icon name="close" size={14} />
              <span className="hidden sm:inline">Exit</span>
            </Button>
          </div>

          <div className="flex items-center gap-4">
            <div
              className="mono"
              style={{ fontSize: 12, color: "var(--muted)", letterSpacing: "0.04em" }}
            >
              <span style={{ color: "var(--fg)", fontWeight: 600 }}>
                {String(mockCard.cardNumber).padStart(2, "0")}
              </span>
              <span style={{ color: "var(--line-2)", margin: "0 6px" }}>/</span>
              <span>{String(mockCard.totalCards).padStart(2, "0")}</span>
            </div>
            <div
              className="hidden sm:flex items-center gap-1.5"
              style={{ fontSize: 11, color: "var(--muted)" }}
            >
              <Icon name="clock" size={12} />
              <span className="mono">~{estimatedMinutes}m</span>
            </div>
          </div>

          <div className="flex gap-1">
            <Button variant="ghost" size="icon" aria-label="Flag">
              <Icon name="flag" size={15} />
            </Button>
            <Button variant="ghost" size="icon" aria-label="Edit">
              <Icon name="edit" size={15} />
            </Button>
          </div>
        </div>

        {/* Progress bar */}
        <div
          style={{
            height: 2,
            background: "var(--surface-1)",
          }}
        >
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

      {/* Main */}
      <main className="flex-1 flex flex-col">
        {/* Deck kicker */}
        <div className="max-w-3xl mx-auto w-full px-4 md:px-6 pt-8 md:pt-12 text-center">
          <span
            className="pill outline"
            style={{ display: "inline-flex" }}
          >
            <Icon name="layers" size={11} />
            {mockCard.deckName}
          </span>
        </div>

        {/* Flashcard */}
        <div className="flex-1 flex items-center justify-center px-4 md:px-6 py-10">
          <div
            className="perspective-1000 w-full max-w-2xl cursor-pointer"
            onClick={handleFlip}
            role="button"
            aria-label="Flip card"
          >
            <div
              className={cn(
                "relative w-full preserve-3d transition-transform duration-300",
                isFlipped && "rotate-y-180"
              )}
              style={{ minHeight: "clamp(260px, 40vh, 420px)" }}
            >
              {/* Front */}
              <div
                className="absolute inset-0 backface-hidden glot-card flex flex-col items-center justify-center p-10 text-center"
                style={{
                  background: "var(--surface)",
                  boxShadow: "0 30px 80px -40px rgba(0,0,0,0.4)",
                }}
              >
                <div
                  className="mono mb-6"
                  style={{ fontSize: 11, color: "var(--muted-2)", letterSpacing: "0.16em" }}
                >
                  QUESTION
                </div>
                <h2
                  className="serif"
                  style={{
                    fontSize: "clamp(40px, 6vw, 64px)",
                    fontWeight: 500,
                    lineHeight: 1.1,
                    letterSpacing: "-0.03em",
                    color: "var(--fg)",
                  }}
                >
                  {mockCard.front}
                </h2>
                <div
                  className="mt-auto pt-8 mono flex items-center gap-2"
                  style={{ fontSize: 11, color: "var(--muted)", letterSpacing: "0.08em" }}
                >
                  TAP OR PRESS <kbd>SPACE</kbd>
                </div>
              </div>

              {/* Back */}
              <div
                className="absolute inset-0 backface-hidden rotate-y-180 glot-card flex flex-col items-center justify-center p-10 text-center"
                style={{
                  background: "var(--surface)",
                  borderColor: "color-mix(in oklab, var(--accent) 35%, var(--line))",
                  boxShadow: "0 30px 80px -40px var(--accent-glow)",
                }}
              >
                <div
                  className="mono mb-4"
                  style={{
                    fontSize: 11,
                    color: "var(--accent)",
                    letterSpacing: "0.16em",
                  }}
                >
                  ANSWER
                </div>
                <h3
                  className="serif"
                  style={{
                    fontSize: 28,
                    fontWeight: 500,
                    color: "var(--accent)",
                    marginBottom: 16,
                  }}
                >
                  {mockCard.front}
                </h3>
                <p
                  className="serif whitespace-pre-line max-w-xl"
                  style={{
                    fontSize: 19,
                    lineHeight: 1.5,
                    color: "var(--fg)",
                    fontWeight: 400,
                  }}
                >
                  {mockCard.back}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Rating footer */}
        <div
          className="px-4 md:px-6 pb-8 pt-4"
          style={{
            borderTop: "1px solid var(--line)",
            background: "var(--bg-1)",
          }}
        >
          <div className="max-w-2xl mx-auto">
            {isFlipped ? (
              <>
                <div
                  className="mono text-center mb-3"
                  style={{
                    fontSize: 10,
                    color: "var(--muted-2)",
                    letterSpacing: "0.16em",
                  }}
                >
                  RATE YOUR RECALL
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {ratingButtons.map((btn) => {
                    const tone = TONE_VARS[btn.tone];
                    return (
                      <button
                        key={btn.label}
                        onClick={() => handleRate(btn.label)}
                        className="focus-glow"
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "center",
                          justifyContent: "center",
                          gap: 2,
                          padding: "14px 8px",
                          borderRadius: "var(--radius)",
                          background: tone.bg,
                          color: tone.fg,
                          border: `1px solid ${tone.border}`,
                          cursor: "pointer",
                          fontWeight: 600,
                          transition: "transform .12s ease, filter .15s ease",
                        }}
                        onMouseEnter={(e) =>
                          (e.currentTarget.style.filter = "brightness(1.05)")
                        }
                        onMouseLeave={(e) =>
                          (e.currentTarget.style.filter = "brightness(1)")
                        }
                      >
                        <span style={{ fontSize: 14 }}>{btn.label}</span>
                        <span
                          className="mono"
                          style={{
                            fontSize: 10,
                            opacity: 0.75,
                            letterSpacing: "0.04em",
                          }}
                        >
                          {btn.description}
                        </span>
                        <kbd
                          style={{
                            marginTop: 4,
                            background: "rgba(0,0,0,0.15)",
                            color: "inherit",
                            border: "1px solid rgba(0,0,0,0.15)",
                          }}
                        >
                          {btn.shortcut}
                        </kbd>
                      </button>
                    );
                  })}
                </div>
              </>
            ) : (
              <div className="flex justify-center">
                <Button
                  size="lg"
                  className="px-12 gap-2"
                  onClick={handleFlip}
                >
                  Show answer
                  <kbd
                    style={{
                      background: "rgba(0,0,0,0.15)",
                      color: "inherit",
                      border: "1px solid rgba(0,0,0,0.2)",
                    }}
                  >
                    SPACE
                  </kbd>
                </Button>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
