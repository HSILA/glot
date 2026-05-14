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
  const total = totalCards ?? cards.length;
  const progress = useMemo(() => {
    if (!deck || deck.cards_count === 0) return 0;
    const done = deck.cards_count - deck.due_count - deck.new_count;
    return Math.max(0, Math.min(100, (done / deck.cards_count) * 100));
  }, [deck]);

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

  return (
    <div className="max-w-5xl mx-auto space-y-8 pb-8">
      {/* Breadcrumb / back */}
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          className="gap-2"
          onClick={() => router.push("/decks")}
        >
          <Icon name="arrowL" size={14} />
          Decks
        </Button>
      </div>

      {/* Deck header */}
      <header
        className="glot-card relative overflow-hidden p-6 md:p-8"
        style={{
          background: `linear-gradient(135deg, color-mix(in oklab, ${deckColor} 8%, var(--surface)) 0%, var(--surface) 60%)`,
        }}
      >
        <div
          aria-hidden
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: 4,
            background: deckColor,
          }}
        />

        <div className="flex items-start gap-4 flex-wrap">
          <div
            className="grid place-items-center flex-shrink-0"
            style={{
              width: 60,
              height: 60,
              borderRadius: 12,
              background: `color-mix(in oklab, ${deckColor} 20%, transparent)`,
              border: `1px solid color-mix(in oklab, ${deckColor} 35%, transparent)`,
              color: deckColor,
            }}
          >
            <Icon name="book" size={26} />
          </div>

          <div className="flex-1 min-w-0">
            <div
              className="mono"
              style={{ fontSize: 11, color: "var(--muted)", letterSpacing: "0.12em" }}
            >
              DECK
            </div>
            <h1
              className="serif mt-1"
              style={{
                fontSize: "clamp(28px, 4vw, 40px)",
                fontWeight: 500,
                lineHeight: 1.05,
                letterSpacing: "-0.02em",
              }}
            >
              {deck.name}
            </h1>
            {deck.description && (
              <p
                className="mt-2 max-w-2xl"
                style={{ fontSize: 14, color: "var(--muted)" }}
              >
                {deck.description}
              </p>
            )}
            {deck.tags && deck.tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-3">
                {deck.tags.map((tag) => (
                  <span key={tag} className="pill outline">{tag}</span>
                ))}
              </div>
            )}
          </div>

          <div className="flex flex-col gap-2 items-stretch sm:items-end">
            <Button
              className="gap-2"
              disabled={deck.due_count + deck.new_count === 0}
              onClick={() => router.push(`/session?deck_id=${deck.id}`)}
            >
              <Icon name="play" size={14} />
              Study deck
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={() => setIsNewCardOpen(true)}
            >
              <Icon name="plus" size={12} />
              Add card
            </Button>
          </div>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mt-7 pt-6"
          style={{ borderTop: "1px solid var(--line)" }}
        >
          <StatCell label="Total" value={deck.cards_count} accent="var(--fg)" />
          <StatCell label="Due" value={deck.due_count} accent="var(--warn)" />
          <StatCell label="New" value={deck.new_count} accent="var(--info)" />
          <div>
            <div
              className="mono"
              style={{ fontSize: 10, color: "var(--muted)", letterSpacing: "0.1em" }}
            >
              MASTERY
            </div>
            <div className="flex items-baseline gap-2 mt-2">
              <span
                className="numeral"
                style={{ fontSize: 28, color: deckColor }}
              >
                {Math.round(progress)}
              </span>
              <span className="mono" style={{ fontSize: 12, color: "var(--muted)" }}>
                %
              </span>
            </div>
            <div
              className="mt-2"
              style={{
                height: 3,
                borderRadius: 2,
                background: "var(--surface-1)",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  height: "100%",
                  width: `${progress}%`,
                  background: deckColor,
                  borderRadius: 2,
                  transition: "width .3s ease",
                }}
              />
            </div>
          </div>
        </div>
      </header>

      {/* Cards section */}
      <section className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <div
              className="mono"
              style={{ fontSize: 11, color: "var(--accent)", letterSpacing: "0.12em" }}
            >
              CARDS
            </div>
            <h2
              className="serif mt-0.5"
              style={{ fontSize: 26, fontWeight: 500, letterSpacing: "-0.02em" }}
            >
              {total} {total === 1 ? "card" : "cards"}
            </h2>
          </div>

          {/* State filter pills */}
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
        </div>

        {/* Cards content */}
        {cardsError && cards.length === 0 && !isLoadingCards ? (
          <div className="glot-card p-12 text-center space-y-4">
            <p style={{ color: "var(--muted)" }}>{cardsError}</p>
            <Button variant="outline" onClick={() => void loadCards(true)}>
              Try again
            </Button>
          </div>
        ) : cards.length === 0 && !isLoadingCards ? (
          <EmptyCards onCreate={() => setIsNewCardOpen(true)} hasFilter={stateFilter !== "all"} />
        ) : (
          <>
            {/* Column header */}
            <div
              className="hidden md:grid mono px-5 py-2"
              style={{
                gridTemplateColumns: "60px 1fr 110px 110px 100px 40px",
                fontSize: 10,
                color: "var(--muted-2)",
                letterSpacing: "0.1em",
                gap: 16,
              }}
            >
              <span>#</span>
              <span>CARD</span>
              <span>STATE</span>
              <span>DUE</span>
              <span>EASE / IVL</span>
              <span></span>
            </div>

            <div className="glot-card divide-y overflow-hidden p-0">
              {cards.map((card) => (
                <CardRow
                  key={card.id}
                  card={card}
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
        className="mono"
        style={{ fontSize: 10, color: "var(--muted)", letterSpacing: "0.1em" }}
      >
        {label.toUpperCase()}
      </div>
      <div
        className="numeral mt-2"
        style={{ fontSize: 28, color: accent, lineHeight: 1 }}
      >
        {value}
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

function CardRow({
  card,
  onEdit,
  onDelete,
}: {
  card: CardWithStatus;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className="px-5 py-4 grid items-start gap-3 md:gap-4 md:items-center"
      style={{
        gridTemplateColumns: "minmax(0, 1fr) auto",
      }}
    >
      <div
        className="md:grid md:items-center"
        style={{
          gridTemplateColumns: "60px 1fr 110px 110px 100px",
          gap: 16,
        }}
      >
        {/* Sequence */}
        <div
          className="mono hidden md:block"
          style={{ fontSize: 12, color: "var(--muted-2)", fontFeatureSettings: '"tnum"' }}
        >
          #{card.sequence}
        </div>

        {/* Content */}
        <div className="min-w-0">
          <p
            className="font-medium truncate"
            style={{ fontSize: 14, color: "var(--fg)" }}
          >
            {card.front_content}
          </p>
          <p
            className="mt-1 line-clamp-1"
            style={{ fontSize: 13, color: "var(--muted)" }}
          >
            {card.back_content}
          </p>
          {card.tags && card.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {card.tags.slice(0, 3).map((tag) => (
                <span key={tag} className="pill outline">{tag}</span>
              ))}
              {card.tags.length > 3 && (
                <span className="pill outline">+{card.tags.length - 3}</span>
              )}
            </div>
          )}
        </div>

        {/* State */}
        <div className="mt-2 md:mt-0">
          <span className={`pill ${card.statusVariant === "default" ? "" : card.statusVariant}`}>
            {card.statusText}
          </span>
        </div>

        {/* Due */}
        <div
          className="mono mt-1 md:mt-0"
          style={{ fontSize: 12, color: "var(--muted)" }}
        >
          <span className="md:hidden" style={{ marginRight: 6, color: "var(--muted-2)" }}>
            Due:
          </span>
          {formatDueRelative(card.next_review_at)}
        </div>

        {/* Ease / Interval */}
        <div
          className="mono mt-1 md:mt-0"
          style={{ fontSize: 11, color: "var(--muted-2)", whiteSpace: "nowrap" }}
        >
          D {card.difficulty.toFixed(1)} · S {card.stability.toFixed(1)}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon">
              <Icon name="more" size={15} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onEdit}>Edit</DropdownMenuItem>
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
