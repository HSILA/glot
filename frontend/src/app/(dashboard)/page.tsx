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

  const greeting = useMemo(() => greetingForHour(new Date().getHours()), []);

  const stats = useMemo(() => {
    const totalDue = decks.reduce((sum, d) => sum + d.due_count, 0);
    const totalNew = decks.reduce((sum, d) => sum + d.new_count, 0);
    const totalCards = decks.reduce((sum, d) => sum + d.cards_count, 0);
    const activeDecks = decks.filter((d) => d.due_count + d.new_count > 0);
    return { totalDue, totalNew, totalCards, activeDecks };
  }, [decks]);

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

  const todayTotal = stats.totalDue + stats.totalNew;

  return (
    <div className="max-w-5xl mx-auto space-y-12 pb-8">
      {/* Editorial hero */}
      <section className="pt-2 md:pt-6">
        <div className="flex items-center gap-2 mb-3">
          <span className="pill outline">
            <Icon name="flame" size={12} />
            {new Date().toLocaleDateString(undefined, {
              weekday: "long",
              month: "short",
              day: "numeric",
            })}
          </span>
        </div>

        <h1
          className="serif"
          style={{
            fontSize: "clamp(40px, 6vw, 64px)",
            lineHeight: 1,
            letterSpacing: "-0.03em",
            fontWeight: 500,
          }}
        >
          {greeting}
          {firstName ? (
            <>
              ,<br />
              <span style={{ color: "var(--accent)" }}>{firstName}</span>.
            </>
          ) : (
            "."
          )}
        </h1>

        <p className="mt-4 max-w-xl" style={{ color: "var(--muted)", fontSize: 15 }}>
          {todayTotal > 0 ? (
            <>
              You have{" "}
              <span style={{ color: "var(--fg)", fontWeight: 600 }}>
                {todayTotal} card{todayTotal === 1 ? "" : "s"}
              </span>{" "}
              waiting across {stats.activeDecks.length} deck
              {stats.activeDecks.length === 1 ? "" : "s"}. Let&apos;s keep momentum.
            </>
          ) : decks.length === 0 ? (
            <>No decks yet. Create your first one to start practicing.</>
          ) : (
            <>Inbox zero. No cards due — a perfect time to add new material.</>
          )}
        </p>
      </section>

      {/* Hero numeral row */}
      <section
        className="grid gap-4 md:grid-cols-[1.4fr_1fr] items-stretch"
        style={{ gap: "calc(16px * var(--d-gap))" }}
      >
        {/* The big number block */}
        <div
          className="glot-card relative overflow-hidden p-6 md:p-8 grid-bg"
          style={{ minHeight: 220 }}
        >
          <div className="absolute inset-x-0 top-0 h-px"
            style={{ background: "linear-gradient(90deg,transparent, var(--accent) 50%, transparent)" }}
          />

          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <div
                className="mono"
                style={{ fontSize: 11, color: "var(--muted)", letterSpacing: "0.12em" }}
              >
                CARDS DUE TODAY
              </div>
              <div
                className="numeral mt-2"
                style={{
                  fontSize: "clamp(80px, 14vw, 140px)",
                  color: "var(--fg)",
                }}
              >
                {todayTotal}
              </div>
              <div
                className="mono mt-1 flex items-center gap-3"
                style={{ fontSize: 12, color: "var(--muted-2)" }}
              >
                <span>{stats.totalDue} review</span>
                <span style={{ color: "var(--line-2)" }}>·</span>
                <span>{stats.totalNew} new</span>
              </div>
            </div>

            <div className="flex flex-col gap-2 items-end">
              <Button
                size="lg"
                className="gap-2"
                disabled={todayTotal === 0}
                onClick={() => router.push("/session")}
              >
                <Icon name="play" size={14} />
                Study now
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => router.push("/decks")}
                className="gap-2"
              >
                <Icon name="plus" size={12} />
                New card
              </Button>
            </div>
          </div>
        </div>

        {/* Side momentum stats */}
        <div className="grid grid-cols-2 gap-3">
          <StatTile
            label="Decks"
            value={decks.length}
            icon="layers"
          />
          <StatTile
            label="Library"
            value={stats.totalCards}
            sub="cards"
            icon="book"
          />
          <StatTile
            label="Active"
            value={stats.activeDecks.length}
            icon="bolt"
          />
          <StatTile
            label="Last"
            value={recentDecks[0] ? formatRelative(recentDecks[0].last_studied_at) : "—"}
            icon="clock"
            small
          />
        </div>
      </section>

      {/* Stack: due decks */}
      {dueDecks.length > 0 && (
        <section>
          <SectionHeader
            kicker="QUEUE"
            title="Due decks"
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
          <div className="grid gap-3 md:grid-cols-2">
            {dueDecks.slice(0, 4).map((deck, idx) => (
              <DeckQueueCard key={deck.id} deck={deck} index={idx} router={router} />
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
            Decks hold cards. Cards flow through the FSRS scheduler to keep you sharp.
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

function StatTile({
  label,
  value,
  sub,
  icon,
  small,
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon: React.ComponentProps<typeof Icon>["name"];
  small?: boolean;
}) {
  return (
    <div className="glot-card p-4 flex flex-col justify-between" style={{ minHeight: 100 }}>
      <div
        className="mono flex items-center gap-2"
        style={{ fontSize: 10, color: "var(--muted)", letterSpacing: "0.1em" }}
      >
        <Icon name={icon} size={12} />
        {label.toUpperCase()}
      </div>
      <div className="mt-2 flex items-baseline gap-1.5">
        <span
          className={small ? "" : "numeral"}
          style={{
            fontSize: small ? 18 : 34,
            fontFamily: small ? "var(--sans)" : undefined,
            fontWeight: small ? 600 : undefined,
            color: "var(--fg)",
            letterSpacing: small ? "-0.01em" : undefined,
          }}
        >
          {value}
        </span>
        {sub && (
          <span
            className="mono"
            style={{ fontSize: 11, color: "var(--muted)" }}
          >
            {sub}
          </span>
        )}
      </div>
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
  index,
  router,
}: {
  deck: Deck;
  index: number;
  router: ReturnType<typeof useRouter>;
}) {
  const total = deck.due_count + deck.new_count;
  return (
    <div
      role="link"
      tabIndex={0}
      onClick={() => router.push(`/decks/${deck.id}`)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          router.push(`/decks/${deck.id}`);
        }
      }}
      className="glot-card p-5 cursor-pointer group relative overflow-hidden"
      style={{
        transition: "border-color .15s ease, transform .15s ease",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = "var(--line-2)";
        e.currentTarget.style.transform = "translateY(-1px)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = "var(--line)";
        e.currentTarget.style.transform = "translateY(0)";
      }}
    >
      {/* Decorative stack lines */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          right: -6,
          top: 18,
          height: 6,
          width: 60,
          borderRadius: 999,
          background: "var(--line)",
          opacity: 0.6,
        }}
      />
      <div
        aria-hidden
        style={{
          position: "absolute",
          right: -12,
          top: 28,
          height: 4,
          width: 80,
          borderRadius: 999,
          background: "var(--line)",
          opacity: 0.4,
        }}
      />

      <div className="flex items-start gap-3">
        <DeckSwatch color={deck.color} />
        <div className="min-w-0 flex-1">
          <div
            className="mono"
            style={{ fontSize: 10, color: "var(--muted)", letterSpacing: "0.1em" }}
          >
            #{String(index + 1).padStart(2, "0")}
          </div>
          <h3
            className="serif mt-1"
            style={{
              fontSize: 20,
              fontWeight: 500,
              letterSpacing: "-0.02em",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {deck.name}
          </h3>
          {deck.description && (
            <p
              className="mt-1 line-clamp-1"
              style={{ fontSize: 13, color: "var(--muted)" }}
            >
              {deck.description}
            </p>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between mt-5 pt-4" style={{ borderTop: "1px solid var(--line)" }}>
        <div className="flex items-center gap-2">
          {deck.due_count > 0 && (
            <span className="pill warn">{deck.due_count} due</span>
          )}
          {deck.new_count > 0 && (
            <span className="pill info">{deck.new_count} new</span>
          )}
          {total === 0 && <span className="pill outline">caught up</span>}
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            router.push(`/session?deck_id=${deck.id}`);
          }}
          className="mono flex items-center gap-1"
          style={{
            fontSize: 11,
            letterSpacing: "0.08em",
            color: "var(--accent)",
            background: "transparent",
            border: "none",
            cursor: "pointer",
            padding: 0,
          }}
        >
          STUDY <Icon name="arrow" size={11} />
        </button>
      </div>
    </div>
  );
}
