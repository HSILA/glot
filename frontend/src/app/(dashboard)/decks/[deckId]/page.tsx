"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
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
import { cardsApi, type Card as FlashCard, type CardState } from "@/lib/api/cards";
import { NewCardModal } from "@/components/cards/new-card-modal";
import { EditCardModal } from "@/components/cards/edit-card-modal";
import { DeleteCardModal } from "@/components/cards/delete-card-modal";

const BATCH_SIZE = 20;

type CardWithStatus = FlashCard & {
  statusText: string;
  statusVariant: "info" | "warn" | "good" | "bad" | "default";
};

function formatDateShort(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatDueRelative(value: string | null): string {
  if (!value) return "—";
  const ts = new Date(value).getTime();
  if (Number.isNaN(ts)) return "—";
  const diff = ts - Date.now();
  const days = Math.round(diff / (1000 * 60 * 60 * 24));
  if (days === 0) return "today";
  if (days < 0) return `${Math.abs(days)}d ago`;
  if (days === 1) return "tomorrow";
  if (days < 30) return `in ${days}d`;
  if (days < 365) return `in ${Math.round(days / 30)}mo`;
  return `in ${Math.round(days / 365)}y`;
}

function getCardStatus(card: FlashCard): CardWithStatus["statusText"] extends string
  ? { text: string; variant: CardWithStatus["statusVariant"] }
  : never;
function getCardStatus(card: FlashCard) {
  switch (card.state) {
    case "new":
      return { text: "New", variant: "info" as const };
    case "learning":
      return { text: "Learning", variant: "warn" as const };
    case "review":
      return { text: "Review", variant: "good" as const };
    case "relearning":
      return { text: "Relearning", variant: "bad" as const };
    default:
      return { text: "Unknown", variant: "default" as const };
  }
}

export default function DeckDetailPage() {
  const params = useParams();
  const router = useRouter();
  const deckId = Number(params.deckId);

  const [deck, setDeck] = useState<Deck | null>(null);
  const [cards, setCards] = useState<CardWithStatus[]>([]);
  const [isLoadingDeck, setIsLoadingDeck] = useState(true);
  const [isLoadingCards, setIsLoadingCards] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cardsError, setCardsError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [offset, setOffset] = useState(0);
  const [totalCards, setTotalCards] = useState<number | null>(null);
  const [isNewCardOpen, setIsNewCardOpen] = useState(false);
  const [selectedCard, setSelectedCard] = useState<FlashCard | null>(null);
  const [isEditCardOpen, setIsEditCardOpen] = useState(false);
  const [isDeleteCardOpen, setIsDeleteCardOpen] = useState(false);
  const [stateFilter, setStateFilter] = useState<CardState | "all">("all");
  const [searchQuery, setSearchQuery] = useState("");

  const handleEditCardOpenChange = (open: boolean) => {
    setIsEditCardOpen(open);
    if (!open) setSelectedCard(null);
  };

  const handleDeleteCardOpenChange = (open: boolean) => {
    setIsDeleteCardOpen(open);
    if (!open) setSelectedCard(null);
  };

  const loadingRef = useRef(false);
  const pendingResetRef = useRef(false);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);

  const loadDeck = useCallback(async () => {
    if (Number.isNaN(deckId)) {
      setError("Invalid deck ID");
      setIsLoadingDeck(false);
      return;
    }
    setIsLoadingDeck(true);
    setError(null);
    try {
      const deckData = await decksApi.getDeck(deckId);
      setDeck(deckData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load deck");
    } finally {
      setIsLoadingDeck(false);
    }
  }, [deckId]);

  const loadCards = useCallback(
    async (reset = false) => {
      if (loadingRef.current) {
        if (reset) pendingResetRef.current = true;
        return;
      }
      if (!reset && !hasMore) return;

      loadingRef.current = true;
      setIsLoadingCards(true);
      setCardsError(null);

      const currentOffset = reset ? 0 : offset;

      try {
        const response = await cardsApi.listCards({
          deck_id: deckId,
          limit: BATCH_SIZE,
          offset: currentOffset,
          ...(stateFilter !== "all" ? { state: stateFilter } : {}),
        });

        setTotalCards(response.total);

        const cardsWithStatus: CardWithStatus[] = response.items.map((card) => {
          const status = getCardStatus(card);
          return {
            ...card,
            statusText: status.text,
            statusVariant: status.variant,
          };
        });

        if (reset) {
          setCards(cardsWithStatus);
          setOffset(response.offset + response.items.length);
        } else {
          setCards((prev) => [...prev, ...cardsWithStatus]);
          setOffset(response.offset + response.items.length);
        }

        setHasMore(response.offset + response.items.length < response.total);
      } catch (err) {
        setCardsError(err instanceof Error ? err.message : "Failed to load cards");
      } finally {
        loadingRef.current = false;
        setIsLoadingCards(false);
        if (pendingResetRef.current) {
          pendingResetRef.current = false;
          void loadCards(true);
        }
      }
    },
    [deckId, offset, hasMore, stateFilter]
  );

  useEffect(() => {
    void loadDeck();
  }, [loadDeck]);

  useEffect(() => {
    if (deck && !isLoadingDeck) {
      void loadCards(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deck, isLoadingDeck, stateFilter]);

  useEffect(() => {
    if (!loadMoreRef.current || !hasMore) return;
    if (observerRef.current) observerRef.current.disconnect();

    observerRef.current = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loadingRef.current) {
          void loadCards();
        }
      },
      { threshold: 0.1, rootMargin: "120px" }
    );

    observerRef.current.observe(loadMoreRef.current);

    return () => {
      if (observerRef.current) observerRef.current.disconnect();
    };
  }, [hasMore, loadCards]);

  const deckColor = deck?.color || "#88d4ff";

  const filteredCards = useMemo(() => {
    if (!searchQuery.trim()) return cards;
    const q = searchQuery.toLowerCase();
    return cards.filter(
      (c) =>
        c.front_content.toLowerCase().includes(q) ||
        c.back_content.toLowerCase().includes(q) ||
        c.tags?.some((t) => t.toLowerCase().includes(q))
    );
  }, [cards, searchQuery]);

  if (Number.isNaN(deckId)) {
    return (
      <div className="text-center py-32 space-y-4">
        <p style={{ color: "var(--muted)" }}>Invalid deck ID</p>
        <Button variant="outline" onClick={() => router.push("/decks")}>
          Back to decks
        </Button>
      </div>
    );
  }

  if (isLoadingDeck) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 className="h-6 w-6 animate-spin" style={{ color: "var(--muted)" }} />
      </div>
    );
  }

  if (error && !deck) {
    return (
      <div className="text-center py-32 space-y-4">
        <p style={{ color: "var(--muted)" }}>{error}</p>
        <div className="flex items-center justify-center gap-3">
          <Button variant="outline" onClick={() => void loadDeck()}>
            Try again
          </Button>
          <Button variant="ghost" onClick={() => router.push("/decks")}>
            Back to decks
          </Button>
        </div>
      </div>
    );
  }

  if (!deck) {
    return (
      <div className="text-center py-32 space-y-4">
        <p style={{ color: "var(--muted)" }}>Deck not found</p>
        <Button variant="outline" onClick={() => router.push("/decks")}>
          Back to decks
        </Button>
      </div>
    );
  }

  const filters: { value: CardState | "all"; label: string }[] = [
    { value: "all", label: "All" },
    { value: "new", label: "New" },
    { value: "learning", label: "Learning" },
    { value: "review", label: "Review" },
    { value: "relearning", label: "Relearning" },
  ];

  const mastered = Math.max(0, deck.cards_count - deck.due_count - deck.new_count);

  return (
    <div className="max-w-5xl mx-auto pb-12">
      {/* Back button */}
      <div className="flex items-center justify-between py-4">
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5"
          onClick={() => router.push("/decks")}
        >
          <Icon name="arrowL" size={12} />
          Decks
        </Button>
        {/* Mobile-only "..." menu */}
        <div className="md:hidden">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon">
                <Icon name="more" size={15} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setIsNewCardOpen(true)}>
                Add card
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Hero header — minimal */}
      <header className="space-y-5">

        <div className="flex items-start justify-between gap-6 flex-wrap">
          <div className="flex-1 min-w-0">
        {/* Mono label: first tag · DECK */}
        <div className="flex items-center gap-1.5">
          {/* Small colored diamond */}
          <span
            aria-hidden
            style={{
              display: "inline-block",
              width: 8,
              height: 8,
              background: deckColor,
              transform: "rotate(45deg)",
              borderRadius: 1.5,
              flexShrink: 0,
            }}
          />
          <span
            className="mono"
            style={{ fontSize: 11, color: "var(--muted)", letterSpacing: "0.12em" }}
          >
            {deck.tags?.[0]
              ? `${deck.tags[0].toUpperCase()} · DECK`
              : "DECK"}
          </span>
        </div>

            {/* Title */}
            <h1
              className="serif mt-3"
              style={{ fontSize: 42, fontWeight: 500, lineHeight: 1.05, letterSpacing: "-0.02em" }}
            >
              {deck.name}
            </h1>

            {/* Description */}
            {deck.description && (
              <p
                className="mt-2"
                style={{ fontSize: 14, color: "var(--muted)", maxWidth: 600 }}
              >
                {deck.description}
              </p>
            )}
          </div>

          {/* Right: Study now + more menu — desktop only */}
          <div className="hidden md:flex items-center gap-2 flex-shrink-0">
            <Button
              className="h-9"
              disabled={deck.due_count + deck.new_count === 0}
              onClick={() => router.push(`/session?deck_id=${deck.id}`)}
            >
              Study now
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon">
                  <Icon name="more" size={15} />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => setIsNewCardOpen(true)}>
                  Add card
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Stats row: 4 large numerals */}
        <div
          className="flex gap-8 pt-5"
          style={{ borderTop: "1px solid var(--line)" }}
        >
          <StatCell label="TOTAL" value={deck.cards_count} accent="var(--fg)" />
          <StatCell label="DUE" value={deck.due_count} accent="var(--warn)" />
          <StatCell label="NEW" value={deck.new_count} accent="var(--info)" />
          <StatCell label="MASTERED" value={mastered} accent="var(--good)" />
        </div>

        {/* Mobile: full-width Study now button below stats */}
        <div className="md:hidden">
          <Button
            size="lg"
            className="w-full"
            disabled={deck.due_count + deck.new_count === 0}
            onClick={() => router.push(`/session?deck_id=${deck.id}`)}
          >
            Study now
          </Button>
        </div>
      </header>

      {/* Cards table — no section heading */}
      <section className="mt-10 space-y-4">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Search */}
          <div
            className="hidden md:flex items-center gap-2 px-3"
            style={{
              maxWidth: 320,
              flex: "1 1 180px",
              height: 36,
              border: "1px solid var(--line)",
              borderRadius: 8,
              background: "var(--surface)",
            }}
          >
            <Icon
              name="search"
              size={13}
              style={{ color: "var(--muted)", flexShrink: 0 }}
            />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search cards..."
              style={{
                flex: 1,
                fontSize: 13,
                background: "transparent",
                outline: "none",
                border: "none",
                color: "var(--fg)",
              }}
            />
          </div>

          {/* Filter pills — unchanged */}
          <div className="flex flex-wrap gap-1.5">
            {filters.map((f) => {
              const active = stateFilter === f.value;
              return (
                <button
                  key={f.value}
                  onClick={() => setStateFilter(f.value)}
                  className="pill"
                  style={{
                    cursor: "pointer",
                    background: active ? "var(--accent)" : "var(--surface-1)",
                    color: active ? "var(--accent-fg)" : "var(--fg-1)",
                    border: active
                      ? "1px solid transparent"
                      : "1px solid var(--line)",
                  }}
                >
                  {f.label}
                </button>
              );
            })}
          </div>

          <div className="hidden md:flex items-center gap-2 ml-auto">
            <Button variant="ghost" size="sm">
              Sort: Recent
            </Button>
            <Button size="sm" className="gap-2" onClick={() => setIsNewCardOpen(true)}>
              <Icon name="plus" size={12} />
              New card
            </Button>
          </div>
        </div>

        {/* Mobile: Cards label + New card row */}
        <div className="md:hidden flex items-center justify-between">
          <span
            className="mono"
            style={{ fontSize: 11, color: "var(--muted)", letterSpacing: "0.12em" }}
          >
            CARDS
          </span>
          <Button size="sm" className="gap-2" onClick={() => setIsNewCardOpen(true)}>
            <Icon name="plus" size={12} />
            New card
          </Button>
        </div>

        {/* Cards content */}
        {cardsError && cards.length === 0 && !isLoadingCards ? (
          <div className="glot-card p-12 text-center space-y-4">
            <p style={{ color: "var(--muted)" }}>{cardsError}</p>
            <Button variant="outline" onClick={() => void loadCards(true)}>
              Try again
            </Button>
          </div>
        ) : filteredCards.length === 0 && !isLoadingCards ? (
          <EmptyCards
            onCreate={() => setIsNewCardOpen(true)}
            hasFilter={stateFilter !== "all" || searchQuery.length > 0}
          />
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden md:block" style={{ overflowX: "auto" }}>
              <div style={{ minWidth: 700 }}>
                {/* Column headers */}
                <div
                  className="mono px-4 py-2"
                  style={{
                    display: "grid",
                    gridTemplateColumns: "60px 1fr 1.2fr 110px 90px 80px 80px 36px",
                    gap: 12,
                    fontSize: 10,
                    color: "var(--muted-2)",
                    letterSpacing: "0.1em",
                  }}
                >
                  <span>SEQ</span>
                  <span>FRONT</span>
                  <span>BACK</span>
                  <span>STATE</span>
                  <span>TAGS</span>
                  <span style={{ textAlign: "right" }}>REPS</span>
                  <span style={{ textAlign: "right" }}>EASE</span>
                  <span />
                </div>

                {/* Card rows */}
                <div
                  style={{
                    border: "1px solid var(--line)",
                    borderRadius: 8,
                    overflow: "hidden",
                  }}
                >
                  {filteredCards.map((card, index) => (
                    <CardRow
                      key={card.id}
                      card={card}
                      index={index}
                      onEdit={() => {
                        setSelectedCard(card);
                        setIsEditCardOpen(true);
                      }}
                      onDelete={() => {
                        setSelectedCard(card);
                        setIsDeleteCardOpen(true);
                      }}
                    />
                  ))}
                </div>
              </div>
            </div>

            {/* Mobile card stack — fits width, no scrollbar */}
            <div className="md:hidden flex flex-col gap-3">
              {filteredCards.map((card, index) => (
                <MobileCardRow
                  key={card.id}
                  card={card}
                  index={index}
                  onEdit={() => {
                    setSelectedCard(card);
                    setIsEditCardOpen(true);
                  }}
                  onDelete={() => {
                    setSelectedCard(card);
                    setIsDeleteCardOpen(true);
                  }}
                />
              ))}
            </div>

            {/* Load more trigger */}
            <div ref={loadMoreRef} className="py-4 space-y-3">
              {cardsError && (
                <div className="text-center space-y-2">
                  <p style={{ fontSize: 13, color: "var(--muted)" }}>{cardsError}</p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void loadCards()}
                    disabled={isLoadingCards}
                  >
                    Try again
                  </Button>
                </div>
              )}

              {isLoadingCards && (
                <div className="flex items-center justify-center">
                  <Loader2 className="h-5 w-5 animate-spin" style={{ color: "var(--muted)" }} />
                </div>
              )}

              {hasMore && !isLoadingCards && !cardsError && cards.length > 0 && (
                <div className="flex justify-center">
                  <Button variant="outline" size="sm" onClick={() => void loadCards()}>
                    Load more
                  </Button>
                </div>
              )}
            </div>
          </>
        )}
      </section>

      <NewCardModal
        open={isNewCardOpen}
        onOpenChange={setIsNewCardOpen}
        deckId={deckId}
        onSuccess={() => void loadCards(true)}
      />

      <EditCardModal
        open={isEditCardOpen && !!selectedCard}
        onOpenChange={handleEditCardOpenChange}
        card={selectedCard}
        onSuccess={() => void loadCards(true)}
      />

      <DeleteCardModal
        open={isDeleteCardOpen && !!selectedCard}
        onOpenChange={handleDeleteCardOpenChange}
        card={selectedCard}
        onDeleted={() => void loadCards(true)}
      />
    </div>
  );
}

function StatCell({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent: string;
}) {
  return (
    <div>
      <div
        className="numeral"
        style={{ fontSize: 32, color: accent, lineHeight: 1 }}
      >
        {value}
      </div>
      <div
        className="mono mt-1"
        style={{ fontSize: 10, color: "var(--muted)", letterSpacing: "0.1em" }}
      >
        {label}
      </div>
    </div>
  );
}

function EmptyCards({
  onCreate,
  hasFilter,
}: {
  onCreate: () => void;
  hasFilter: boolean;
}) {
  return (
    <div className="glot-card p-12 text-center">
      <div
        className="inline-flex items-center justify-center mb-5"
        style={{
          width: 56,
          height: 56,
          borderRadius: 12,
          background: "var(--surface-1)",
          border: "1px solid var(--line)",
          color: "var(--accent)",
        }}
      >
        <Icon name="book" size={24} />
      </div>
      <h3
        className="serif"
        style={{ fontSize: 22, fontWeight: 500 }}
      >
        {hasFilter ? "No cards in this state" : "No cards in this deck yet"}
      </h3>
      <p
        className="mt-2 mx-auto max-w-md"
        style={{ color: "var(--muted)", fontSize: 14 }}
      >
        {hasFilter
          ? "Try a different filter, or add new cards to this deck."
          : "Add your first card to begin studying."}
      </p>
      {!hasFilter && (
        <Button className="mt-6 gap-2" onClick={onCreate}>
          <Icon name="plus" size={14} />
          Add card
        </Button>
      )}
    </div>
  );
}

const GRID = "60px 1fr 1.2fr 110px 90px 80px 80px 36px";

function MobileCardRow({
  card,
  index,
  onEdit: _onEdit,
  onDelete: _onDelete,
}: {
  card: CardWithStatus;
  index: number;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      style={{
        padding: "12px 14px",
        border: "1px solid var(--line)",
        borderRadius: 10,
        background: index % 2 === 0 ? "var(--surface)" : "var(--bg-1)",
        display: "flex",
        gap: 10,
        alignItems: "stretch",
      }}
    >
      {/* SEQ — centered vertically */}
      <div className="flex items-center justify-center flex-shrink-0" style={{ minWidth: 40 }}>
        <span className="mono" style={{ fontSize: 11, color: "var(--muted)" }}>
          #{card.sequence}
        </span>
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="serif truncate" style={{ fontSize: 16, fontWeight: 500 }}>
          {card.front_content}
        </div>
        <div className="truncate mt-1" style={{ fontSize: 13, color: "var(--fg-1)" }}>
          {card.back_content}
        </div>
      </div>

      {/* Status pill — top-right */}
      <div className="flex-shrink-0 flex items-start">
        <span className={`pill ${card.statusVariant === "default" ? "" : card.statusVariant}`}>
          {card.statusText}
        </span>
      </div>
    </div>
  );
}

function CardRow({
  card,
  index,
  onEdit,
  onDelete,
}: {
  card: CardWithStatus;
  index: number;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const easeColor =
    card.difficulty > 2.5
      ? "var(--good)"
      : card.difficulty > 1
        ? "var(--warn)"
        : "var(--muted)";

  return (
    <div
      className="grid items-center px-4"
      style={{
        gridTemplateColumns: GRID,
        gap: 12,
        minHeight: 52,
        background: index % 2 === 0 ? "var(--surface)" : "var(--bg-1)",
        borderBottom: "1px solid var(--line)",
      }}
    >
      {/* SEQ */}
      <div className="mono" style={{ fontSize: 11, color: "var(--muted)" }}>
        #{card.sequence}
      </div>

      {/* FRONT */}
      <div
        className="serif truncate"
        style={{ fontSize: 18, fontWeight: 500 }}
      >
        {card.front_content}
      </div>

      {/* BACK */}
      <div className="truncate" style={{ fontSize: 13, color: "var(--fg-1)" }}>
        {card.back_content}
      </div>

      {/* STATE */}
      <div>
        <span className={`pill ${card.statusVariant === "default" ? "" : card.statusVariant}`}>
          {card.statusText}
        </span>
      </div>

      {/* TAGS */}
      <div className="flex gap-1 overflow-hidden">
        {card.tags?.slice(0, 2).map((tag) => (
          <span
            key={tag}
            style={{
              fontSize: 9,
              fontFamily: "var(--mono)",
              textTransform: "uppercase",
              letterSpacing: "0.04em",
              padding: "2px 7px",
              borderRadius: 999,
              border: "1px solid var(--line)",
              background: "transparent",
              color: "var(--fg-1)",
              whiteSpace: "nowrap",
            }}
          >
            {tag}
          </span>
        ))}
      </div>

      {/* REPS */}
      <div
        className="mono"
        style={{ fontSize: 12, color: "var(--muted)", textAlign: "right" }}
      >
        {card.reps}
      </div>

      {/* EASE */}
      <div
        className="mono"
        style={{ fontSize: 12, color: easeColor, textAlign: "right" }}
      >
        {card.difficulty.toFixed(1)}
      </div>

      {/* Menu */}
      <div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon">
              <Icon name="more" size={14} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onEdit}>Edit</DropdownMenuItem>
            <DropdownMenuItem disabled>
              Due {formatDueRelative(card.next_review_at)}
            </DropdownMenuItem>
            <DropdownMenuItem disabled>
              Created {formatDateShort(card.created_at)}
            </DropdownMenuItem>
            <DropdownMenuItem className="text-destructive" onSelect={onDelete}>
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
