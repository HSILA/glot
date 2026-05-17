"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/glot/icon";
import { useAuth } from "@/components/providers/auth-provider";
import { decksApi, type Deck } from "@/lib/api/decks";

async function listAllDecks(): Promise<Deck[]> {
  const all: Deck[] = [];
  const limit = 100;
  let offset = 0;
  while (true) {
    const page = await decksApi.listDecks({ limit, offset });
    all.push(...page);
    if (page.length < limit) break;
    offset += limit;
  }
  return all;
}

function greetingForHour(hour: number): string {
  if (hour < 5) return "Late night";
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  if (hour < 21) return "Good evening";
  return "Good night";
}

function formatRelative(value: string | null): string {
  if (!value) return "Never studied";
  const ts = new Date(value).getTime();
  if (Number.isNaN(ts)) return "Unknown";
  const days = Math.floor((Date.now() - ts) / (1000 * 60 * 60 * 24));
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

function formatHeroDate(date: Date): string {
  return date
    .toLocaleDateString(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
    })
    .replace(",", " ·")
    .toUpperCase();
}

export default function MyDayPage() {
  const router = useRouter();
  const { user } = useAuth();

  const [decks, setDecks] = useState<Deck[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const requestIdRef = useRef(0);

  const loadDecks = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setIsLoading(true);
    setError(null);
    try {
      const userDecks = await listAllDecks();
      if (requestId !== requestIdRef.current) return;
      setDecks(userDecks);
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      if (requestId === requestIdRef.current) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDecks();
    return () => {
      requestIdRef.current += 1;
    };
  }, [loadDecks]);

  const now = useMemo(() => new Date(), []);
  const greeting = useMemo(() => greetingForHour(now.getHours()), [now]);
  const heroDate = useMemo(() => formatHeroDate(now), [now]);

  const stats = useMemo(() => {
    const totalDue = decks.reduce((sum, d) => sum + d.due_count, 0);
    const totalNew = decks.reduce((sum, d) => sum + d.new_count, 0);
    const activeDecks = decks.filter((d) => d.due_count + d.new_count > 0);
    return { totalDue, totalNew, activeDecks };
  }, [decks]);

  const todayTotal = stats.totalDue + stats.totalNew;

  // SPACE key — start session
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.code === "Space" && todayTotal > 0) {
        e.preventDefault();
        router.push("/session");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [todayTotal, router]);

  const recentDecks = useMemo(() => {
    return [...decks]
      .filter((d) => d.last_studied_at)
      .sort((a, b) => {
        const ta = new Date(a.last_studied_at ?? 0).getTime();
        const tb = new Date(b.last_studied_at ?? 0).getTime();
        return tb - ta;
      })
      .slice(0, 4);
  }, [decks]);

  const dueDecks = useMemo(
    () =>
      [...stats.activeDecks].sort(
        (a, b) => b.due_count + b.new_count - (a.due_count + a.new_count)
      ),
    [stats.activeDecks]
  );

  const firstName = useMemo(() => {
    if (!user) return "";
    if (user.display_name) return user.display_name.split(" ")[0];
    return user.email.split("@")[0];
  }, [user]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 className="h-6 w-6 animate-spin" style={{ color: "var(--muted)" }} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-32 space-y-4">
        <p style={{ color: "var(--muted)" }}>{error}</p>
        <Button variant="outline" onClick={() => void loadDecks()}>
          Try again
        </Button>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-12 pb-8">
      {/* My Day hero — aligned with redesign mockup */}
      <section className="pt-2 md:pt-6">
        <div className="flex items-baseline justify-between gap-4 mb-10 md:mb-14">
          <div>
            <div
              className="mono"
              style={{ fontSize: 11, color: "var(--muted)", letterSpacing: "0.12em", marginBottom: 8 }}
            >
              {heroDate}
            </div>
            <h1
              className="serif"
              style={{
                fontSize: "clamp(34px, 5vw, 48px)",
                fontWeight: 500,
                letterSpacing: "-0.03em",
                lineHeight: 1,
              }}
            >
              {greeting}
              {firstName ? (
                <>
                  , <span style={{ fontStyle: "italic", color: "var(--muted)" }}>{firstName}</span>.
                </>
              ) : (
                "."
              )}
            </h1>
          </div>
        </div>

        <div
          className="relative overflow-hidden"
          style={{
            padding: "clamp(28px, 6vw, 56px)",
            borderRadius: 18,
            background: "var(--surface)",
            border: "1px solid var(--line)",
          }}
        >
          <div
            aria-hidden
            style={{
              position: "absolute",
              top: -100,
              right: -100,
              width: 360,
              height: 360,
              background: "radial-gradient(circle, var(--accent-glow), transparent 60%)",
              pointerEvents: "none",
            }}
          />
          <div className="relative flex flex-col gap-8 md:flex-row md:items-end md:justify-between">
            <div style={{ flex: 1 }}>
              <div
                className="mono"
                style={{ fontSize: 12, color: "var(--accent)", letterSpacing: "0.12em", marginBottom: 16 }}
              >
                ▸ TODAY
              </div>
              <div className="flex items-end gap-4 md:gap-[18px] mb-3">
                <span className="numeral" style={{ fontSize: "clamp(110px, 18vw, 200px)" }}>
                  {todayTotal}
                </span>
                <div style={{ paddingBottom: "clamp(14px, 2vw, 24px)" }}>
                  <div
                    className="serif"
                    style={{ fontSize: "clamp(22px, 4vw, 32px)", lineHeight: 1, fontStyle: "italic", color: "var(--muted)" }}
                  >
                    cards
                  </div>
                  <div style={{ fontSize: 14, color: "var(--muted)", marginTop: 6 }}>to study</div>
                </div>
              </div>
              <div className="flex gap-6 mt-5" style={{ color: "var(--muted)", fontSize: 13 }}>
                <span>
                  <span className="mono" style={{ color: "var(--warn)" }}>{stats.totalDue}</span> due
                </span>
                <span>
                  <span className="mono" style={{ color: "var(--info)" }}>{stats.totalNew}</span> new
                </span>
              </div>
            </div>
            <Button
              onClick={() => router.push("/session")}
              disabled={todayTotal === 0}
              size="lg"
              className="gap-3 pulse"
              style={{ padding: "20px 32px", fontSize: 17 }}
            >
              <Icon name="play" size={18} /> Start session
              <span className="mono" style={{ fontSize: 11, opacity: 0.6, marginLeft: 4 }}>SPACE</span>
            </Button>
          </div>
        </div>
      </section>

      {/* Stack: due decks — Variant B card-stack style */}
      {dueDecks.length > 0 && (
        <section>
          <SectionHeader
            kicker="QUEUE"
            title="All decks"
            action={
              <Link
                href="/decks"
                className="mono flex items-center gap-1"
                style={{ fontSize: 11, color: "var(--muted)", letterSpacing: "0.06em" }}
              >
                ALL DECKS <Icon name="arrow" size={11} />
              </Link>
            }
          />
          <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
            {dueDecks.map((deck) => (
              <DeckQueueCard key={deck.id} deck={deck} router={router} />
            ))}
          </div>
        </section>
      )}

      {/* Recent activity */}
      {recentDecks.length > 0 && (
        <section>
          <SectionHeader kicker="ACTIVITY" title="Recently studied" />
          <div
            className="glot-card divide-y overflow-hidden"
            style={{ borderColor: "var(--line)" }}
          >
            {recentDecks.map((deck) => (
              <button
                key={deck.id}
                onClick={() => router.push(`/decks/${deck.id}`)}
                className="w-full flex items-center gap-4 px-5 py-4 text-left transition-colors"
                style={{ borderColor: "var(--line)" }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.background = "var(--surface-1)")
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.background = "transparent")
                }
              >
                <DeckSwatch color={deck.color} />
                <div className="flex-1 min-w-0">
                  <div
                    className="serif"
                    style={{
                      fontSize: 18,
                      fontWeight: 500,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {deck.name}
                  </div>
                  <div
                    className="mono mt-0.5"
                    style={{ fontSize: 11, color: "var(--muted)", letterSpacing: "0.04em" }}
                  >
                    {deck.cards_count} cards · {formatRelative(deck.last_studied_at)}
                  </div>
                </div>
                <div className="hidden sm:flex items-center gap-2">
                  {deck.due_count > 0 && (
                    <span className="pill warn">{deck.due_count} due</span>
                  )}
                  {deck.new_count > 0 && (
                    <span className="pill info">{deck.new_count} new</span>
                  )}
                </div>
                <Icon name="chev" size={14} style={{ color: "var(--muted-2)" }} />
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Empty state */}
      {decks.length === 0 && (
        <section className="glot-card p-12 text-center">
          <div
            className="inline-flex items-center justify-center mb-5"
            style={{
              width: 64,
              height: 64,
              borderRadius: 14,
              background: "var(--surface-1)",
              border: "1px solid var(--line)",
              color: "var(--accent)",
            }}
          >
            <Icon name="layers" size={28} />
          </div>
          <h2 className="serif" style={{ fontSize: 24, fontWeight: 500 }}>
            Build your first deck
          </h2>
          <p
            className="mt-2 mx-auto max-w-md"
            style={{ color: "var(--muted)", fontSize: 14 }}
          >
            Decks hold cards. Cards flow through our smart scheduler to keep you sharp — for any topic, not just languages.
          </p>
          <Button className="mt-6 gap-2" onClick={() => router.push("/decks")}>
            <Icon name="plus" size={14} />
            Create deck
          </Button>
        </section>
      )}
    </div>
  );
}


function SectionHeader({
  kicker,
  title,
  action,
}: {
  kicker: string;
  title: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-end justify-between mb-4 gap-4">
      <div>
        <div
          className="mono"
          style={{ fontSize: 11, color: "var(--accent)", letterSpacing: "0.12em" }}
        >
          {kicker}
        </div>
        <h2
          className="serif mt-1"
          style={{ fontSize: 28, fontWeight: 500, letterSpacing: "-0.02em" }}
        >
          {title}
        </h2>
      </div>
      {action}
    </div>
  );
}

function DeckSwatch({ color }: { color: string | null }) {
  const c = color || "var(--accent)";
  return (
    <div
      aria-hidden
      style={{
        width: 38,
        height: 38,
        borderRadius: 8,
        background: `color-mix(in oklab, ${c} 16%, transparent)`,
        border: `1px solid color-mix(in oklab, ${c} 30%, transparent)`,
        display: "grid",
        placeItems: "center",
        flexShrink: 0,
      }}
    >
      <span
        style={{
          width: 14,
          height: 14,
          borderRadius: 4,
          background: c,
          display: "block",
        }}
      />
    </div>
  );
}

function DeckQueueCard({
  deck,
  router,
}: {
  deck: Deck;
  router: ReturnType<typeof useRouter>;
}) {
  const due = deck.due_count;
  const newCount = deck.new_count;
  const total = due + newCount;
  const primaryTag = deck.tags?.[0] || null;
  const c = deck.color || "var(--accent)";

  return (
    <div
      role="link"
      tabIndex={0}
      aria-label={`Open deck ${deck.name}`}
      onClick={() => router.push(`/decks/${deck.id}`)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          router.push(`/decks/${deck.id}`);
        }
      }}
      className="relative cursor-pointer group overflow-hidden"
      style={{
        padding: "18px 18px 16px",
        borderRadius: 16,
        background: "var(--surface)",
        border: "1px solid var(--line)",
        minHeight: 160,
        transition: "transform .15s, border-color .15s",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = "var(--line-2)";
        e.currentTarget.style.transform = "translateY(-2px)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = "var(--line)";
        e.currentTarget.style.transform = "none";
      }}
    >
      {/* Colored spine */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          width: 3,
          background: c,
        }}
      />

      {/* Top row: tag + due pill */}
      <div className="flex justify-between items-start">
        <span
          className="mono"
          style={{ fontSize: 10, color: "var(--muted)", letterSpacing: "0.14em" }}
        >
          {primaryTag ? primaryTag.toUpperCase() : "DECK"} · {deck.cards_count}
        </span>
        {due > 0 && (
          <div
            className="mono"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              padding: "3px 8px",
              borderRadius: 999,
              background: "var(--accent)",
              color: "var(--accent-fg)",
              fontSize: 11,
              fontWeight: 600,
            }}
          >
            {due} due
          </div>
        )}
      </div>

      {/* Deck name */}
      <div
        className="serif mt-7"
        style={{
          fontSize: 20,
          fontWeight: 500,
          lineHeight: 1.15,
          letterSpacing: "-0.02em",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {deck.name}
      </div>

      {/* Card count */}
      <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
        {deck.cards_count} cards
      </div>

      {/* Colored accent bar */}
      <div
        style={{
          height: 2,
          background: c,
          marginTop: 14,
          opacity: 0.7,
        }}
      />
    </div>
  );
}
