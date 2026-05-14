"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Icon } from "@/components/glot/icon";
import { decksApi, type Deck } from "@/lib/api/decks";
import {
  DECK_COLOR_OPTIONS,
  NewDeckModal,
} from "@/components/decks/new-deck-modal";
import { EditDeckModal } from "@/components/decks/edit-deck-modal";
import { DeleteDeckModal } from "@/components/decks/delete-deck-modal";

type DeckWithStats = Omit<Deck, "color"> & { color: string };

type SortMode = "recent" | "due" | "alpha" | "size";

function formatLastStudied(lastStudiedAt: string | null): string {
  if (!lastStudiedAt) return "Never";
  const ts = new Date(lastStudiedAt).getTime();
  if (Number.isNaN(ts)) return "Unknown";
  const days = Math.floor((Date.now() - ts) / (1000 * 60 * 60 * 24));
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

function colorForDeck(deck: Deck): string {
  if (deck.color) return deck.color;
  return DECK_COLOR_OPTIONS[(deck.id - 1) % DECK_COLOR_OPTIONS.length];
}

async function listAllDecks(): Promise<Deck[]> {
  const allDecks: Deck[] = [];
  const limit = 100;
  let offset = 0;

  while (true) {
    const page = await decksApi.listDecks({ limit, offset });
    allDecks.push(...page);
    if (page.length < limit) break;
    offset += limit;
  }

  return allDecks;
}

export default function DecksPage() {
  const router = useRouter();

  const [decks, setDecks] = useState<DeckWithStats[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isCreateDeckOpen, setIsCreateDeckOpen] = useState(false);
  const [deckToEdit, setDeckToEdit] = useState<Deck | null>(null);
  const [deckToDelete, setDeckToDelete] = useState<Deck | null>(null);
  const [search, setSearch] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("recent");

  const requestIdRef = useRef(0);

  const loadDecks = useCallback(async () => {
    const requestId = ++requestIdRef.current;

    setIsLoading(true);
    setError(null);

    try {
      const userDecks = await listAllDecks();
      const decksWithStats = userDecks.map((deck) => ({
        ...deck,
        color: colorForDeck(deck),
      }));
      if (requestId !== requestIdRef.current) return;
      setDecks(decksWithStats);
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      setError(err instanceof Error ? err.message : "Failed to load decks");
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

  const totalDue = useMemo(
    () => decks.reduce((sum, deck) => sum + deck.due_count, 0),
    [decks]
  );

  const totalNew = useMemo(
    () => decks.reduce((sum, deck) => sum + deck.new_count, 0),
    [decks]
  );

  const totalToday = totalDue + totalNew;

  const totalCards = useMemo(
    () => decks.reduce((sum, deck) => sum + deck.cards_count, 0),
    [decks]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const arr = q
      ? decks.filter(
          (d) =>
            d.name.toLowerCase().includes(q) ||
            (d.description ?? "").toLowerCase().includes(q) ||
            (d.tags ?? []).some((t) => t.toLowerCase().includes(q))
        )
      : [...decks];

    arr.sort((a, b) => {
      switch (sortMode) {
        case "due":
          return b.due_count + b.new_count - (a.due_count + a.new_count);
        case "alpha":
          return a.name.localeCompare(b.name);
        case "size":
          return b.cards_count - a.cards_count;
        case "recent":
        default: {
          const ta = a.last_studied_at ? new Date(a.last_studied_at).getTime() : 0;
          const tb = b.last_studied_at ? new Date(b.last_studied_at).getTime() : 0;
          if (ta === tb) return a.name.localeCompare(b.name);
          return tb - ta;
        }
      }
    });

    return arr;
  }, [decks, search, sortMode]);

  const handleDeckCreated = async () => {
    await loadDecks();
  };

  const handleDeckUpdated = async (updatedDeck: Deck) => {
    setDecks((prev) =>
      prev.map((d) =>
        d.id === updatedDeck.id
          ? { ...d, ...updatedDeck, color: colorForDeck(updatedDeck) }
          : d
      )
    );
  };

  const handleDeckDeleted = (deckId: number) => {
    setDecks((prev) => prev.filter((d) => d.id !== deckId));
  };

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

  const sortLabel: Record<SortMode, string> = {
    recent: "Recent",
    due: "Most due",
    alpha: "A → Z",
    size: "Largest",
  };

  return (
    <div className="max-w-5xl mx-auto space-y-8 pb-8">
      {/* Editorial header */}
      <header>
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
          <div>
            <div
              className="mono"
              style={{
                fontSize: 11,
                color: "var(--muted)",
                letterSpacing: "0.12em",
                marginBottom: 6,
              }}
            >
              {decks.length.toLocaleString()} {decks.length === 1 ? "DECK" : "DECKS"} ·{" "}
              {totalCards.toLocaleString()} {totalCards === 1 ? "CARD" : "CARDS"}
            </div>
            <h1
              className="serif"
              style={{
                fontSize: "clamp(36px, 5vw, 56px)",
                fontWeight: 500,
                lineHeight: 1,
                letterSpacing: "-0.03em",
              }}
            >
              Your <span style={{ fontStyle: "italic", color: "var(--muted)" }}>shelves.</span>
            </h1>
          </div>
          <Button className="gap-2" onClick={() => setIsCreateDeckOpen(true)}>
            <Icon name="plus" size={14} />
            New deck
          </Button>
        </div>
      </header>

      {/* Quick-study CTA */}
      {totalToday > 0 && (
        <div
          className="glot-card p-5 flex flex-col sm:flex-row items-start sm:items-center gap-4"
          style={{
            background:
              "linear-gradient(to right, color-mix(in oklab, var(--accent) 6%, var(--surface)), var(--surface))",
            borderColor: "color-mix(in oklab, var(--accent) 30%, var(--line))",
          }}
        >
          <div
            className="grid place-items-center flex-shrink-0"
            style={{
              width: 44,
              height: 44,
              borderRadius: 10,
              background: "var(--accent)",
              color: "var(--accent-fg)",
            }}
          >
            <Icon name="play" size={18} />
          </div>
          <div className="flex-1 min-w-0">
            <div
              className="serif"
              style={{ fontSize: 18, fontWeight: 500 }}
            >
              Ready to study?
            </div>
            <div className="mono mt-0.5" style={{ fontSize: 11, color: "var(--muted)" }}>
              {totalDue} DUE · {totalNew} NEW
            </div>
          </div>
          <Button onClick={() => router.push("/session")} className="gap-2">
            Start session
            <Icon name="arrow" size={12} />
          </Button>
        </div>
      )}

      {/* Search + sort row */}
      {decks.length > 0 && (
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Icon
              name="search"
              size={15}
              className="absolute"
              style={{
                left: 12,
                top: "50%",
                transform: "translateY(-50%)",
                color: "var(--muted)",
              }}
            />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search decks, tags, descriptions…"
              className="w-full h-10 pl-10 pr-4 rounded-lg text-sm outline-none focus-glow"
              style={{
                background: "var(--bg-1)",
                border: "1px solid var(--line)",
                color: "var(--fg)",
              }}
            />
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="gap-2">
                <Icon name="filter" size={14} />
                {sortLabel[sortMode]}
                <Icon name="chevD" size={12} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setSortMode("recent")}>
                Recently studied
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSortMode("due")}>
                Most due first
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSortMode("alpha")}>
                Alphabetical
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSortMode("size")}>
                Largest first
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}

      {/* Empty / no results */}
      {decks.length === 0 ? (
        <EmptyDecks onCreate={() => setIsCreateDeckOpen(true)} />
      ) : filtered.length === 0 ? (
        <div className="glot-card p-12 text-center">
          <p style={{ color: "var(--muted)" }}>No decks match &ldquo;{search}&rdquo;.</p>
          <Button
            variant="outline"
            className="mt-4"
            onClick={() => setSearch("")}
          >
            Clear search
          </Button>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {filtered.map((deck) => (
            <DeckRowCard
              key={deck.id}
              deck={deck}
              onOpen={() => router.push(`/decks/${deck.id}`)}
              onStudy={() => router.push(`/session?deck_id=${deck.id}`)}
              onEdit={() => setDeckToEdit(deck)}
              onDelete={() => setDeckToDelete(deck)}
            />
          ))}
        </div>
      )}

      <NewDeckModal
        open={isCreateDeckOpen}
        onOpenChange={setIsCreateDeckOpen}
        onCreated={handleDeckCreated}
      />

      {deckToEdit && (
        <EditDeckModal
          open={Boolean(deckToEdit)}
          onOpenChange={(open) => {
            if (!open) setDeckToEdit(null);
          }}
          deck={deckToEdit}
          onUpdated={(updatedDeck) => void handleDeckUpdated(updatedDeck)}
        />
      )}

      {deckToDelete && (
        <DeleteDeckModal
          open={Boolean(deckToDelete)}
          onOpenChange={(open) => {
            if (!open) setDeckToDelete(null);
          }}
          deck={deckToDelete}
          onDeleted={handleDeckDeleted}
        />
      )}
    </div>
  );
}

function EmptyDecks({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="glot-card p-12 text-center grid-bg">
      <div
        className="inline-flex items-center justify-center mb-5"
        style={{
          width: 72,
          height: 72,
          borderRadius: 16,
          background: "var(--surface-1)",
          border: "1px solid var(--line)",
          color: "var(--accent)",
        }}
      >
        <Icon name="layers" size={30} />
      </div>
      <h2
        className="serif"
        style={{ fontSize: 28, fontWeight: 500, letterSpacing: "-0.02em" }}
      >
        No decks yet
      </h2>
      <p
        className="mt-2 mx-auto max-w-md"
        style={{ color: "var(--muted)", fontSize: 14 }}
      >
        Decks group your cards by topic. Spin one up to start practicing.
      </p>
      <Button className="mt-6 gap-2" onClick={onCreate}>
        <Icon name="plus" size={14} />
        Create your first deck
      </Button>
    </div>
  );
}

function DeckRowCard({
  deck,
  onOpen,
  onStudy,
  onEdit,
  onDelete,
}: {
  deck: DeckWithStats;
  onOpen: () => void;
  onStudy: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const due = deck.due_count;
  const newCount = deck.new_count;
  const total = deck.cards_count;
  const progress = total > 0 ? Math.max(0, Math.min(100, ((total - due - newCount) / total) * 100)) : 0;

  return (
    <div
      role="link"
      tabIndex={0}
      aria-label={`Open deck ${deck.name}`}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      className="glot-card p-5 cursor-pointer group focus-glow relative overflow-hidden"
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
      {/* Accent bar */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          width: 3,
          background: deck.color,
        }}
      />

      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0 flex-1 pl-1">
          <div
            className="grid place-items-center flex-shrink-0"
            style={{
              width: 44,
              height: 44,
              borderRadius: 10,
              background: `color-mix(in oklab, ${deck.color} 18%, transparent)`,
              border: `1px solid color-mix(in oklab, ${deck.color} 30%, transparent)`,
              color: deck.color,
            }}
          >
            <Icon name="book" size={20} />
          </div>
          <div className="min-w-0 flex-1">
            <h3
              className="serif"
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
            <p
              className="mt-1 line-clamp-2"
              style={{ fontSize: 13, color: "var(--muted)" }}
            >
              {deck.description || "No description"}
            </p>
            {deck.tags && deck.tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {deck.tags.slice(0, 4).map((tag) => (
                  <span key={tag} className="pill outline">{tag}</span>
                ))}
              </div>
            )}
          </div>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="opacity-0 group-hover:opacity-100 focus:opacity-100"
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
            >
              <Icon name="more" size={16} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onEdit();
              }}
            >
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem disabled>Export</DropdownMenuItem>
            <DropdownMenuItem
              className="text-destructive"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onDelete();
              }}
            >
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Stats row */}
      <div className="flex items-center gap-2 mt-4">
        {due > 0 && <span className="pill warn">{due} due</span>}
        {newCount > 0 && <span className="pill info">{newCount} new</span>}
        {due === 0 && newCount === 0 && (
          <span className="pill good">caught up</span>
        )}
        <span
          className="mono ml-auto"
          style={{ fontSize: 11, color: "var(--muted-2)", letterSpacing: "0.04em" }}
        >
          {total} TOTAL
        </span>
      </div>

      {/* Progress + footer */}
      <div className="mt-4 space-y-2">
        <div
          style={{
            height: 4,
            borderRadius: 2,
            background: "var(--surface-1)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${progress}%`,
              background: deck.color,
              borderRadius: 2,
              transition: "width .3s ease",
            }}
          />
        </div>

        <div className="flex items-center justify-between">
          <span
            className="mono"
            style={{ fontSize: 11, color: "var(--muted-2)", letterSpacing: "0.04em" }}
          >
            {formatLastStudied(deck.last_studied_at).toUpperCase()}
          </span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onStudy();
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
    </div>
  );
}
