"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  BookOpen,
  MoreHorizontal,
  Plus,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { decksApi, type Deck } from "@/lib/api/decks";
import { cardsApi, type Card as FlashCard } from "@/lib/api/cards";
import { NewCardModal } from "@/components/cards/new-card-modal";
import { EditCardModal } from "@/components/cards/edit-card-modal";
import { DeleteCardModal } from "@/components/cards/delete-card-modal";

const BATCH_SIZE = 10;

type CardWithStatus = FlashCard & {
  statusText: string;
  statusColor: string;
};

function formatDateYYYYMMDD(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";

  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function getCardStatus(card: FlashCard): { text: string; color: string } {
  switch (card.state) {
    case "new":
      return { text: "New", color: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" };
    case "learning":
      return { text: "Learning", color: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400" };
    case "review":
      return { text: "Review", color: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" };
    case "relearning":
      return { text: "Relearning", color: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400" };
    default:
      return { text: "Unknown", color: "bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-400" };
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

  const loadCards = useCallback(async (reset = false) => {
    // If a reset is requested while an infinite-scroll fetch is in flight,
    // queue it and run it immediately after the current request finishes.
    if (loadingRef.current) {
      if (reset) {
        pendingResetRef.current = true;
      }
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
      });

      setTotalCards(response.total);

      const cardsWithStatus = response.items.map((card) => {
        const status = getCardStatus(card);
        return {
          ...card,
          statusText: status.text,
          statusColor: status.color,
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
        // Fire-and-forget; loadCards handles its own loading guard.
        void loadCards(true);
      }
    }
  }, [deckId, offset, hasMore]);

  useEffect(() => {
    void loadDeck();
  }, [loadDeck]);

  useEffect(() => {
    if (deck && !isLoadingDeck) {
      void loadCards(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deck, isLoadingDeck]);

  useEffect(() => {
    if (!loadMoreRef.current || !hasMore) return;

    if (observerRef.current) {
      observerRef.current.disconnect();
    }

    observerRef.current = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loadingRef.current) {
          void loadCards();
        }
      },
      { threshold: 0.1, rootMargin: "100px" }
    );

    observerRef.current.observe(loadMoreRef.current);

    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
      }
    };
  }, [hasMore, loadCards]);

  if (Number.isNaN(deckId)) {
    return (
      <div className="text-center py-20">
        <p className="text-muted-foreground">Invalid deck ID</p>
        <Button variant="outline" className="mt-4" onClick={() => router.push("/decks")}>
          Back to Decks
        </Button>
      </div>
    );
  }

  if (isLoadingDeck) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error && !deck) {
    return (
      <div className="text-center py-20 space-y-4">
        <p className="text-muted-foreground">{error}</p>
        <div className="flex items-center justify-center gap-3">
          <Button variant="outline" onClick={() => void loadDeck()}>
            Try Again
          </Button>
          <Button variant="ghost" onClick={() => router.push("/decks")}>
            Back to Decks
          </Button>
        </div>
      </div>
    );
  }

  if (!deck) {
    return (
      <div className="text-center py-20">
        <p className="text-muted-foreground">Deck not found</p>
        <Button variant="outline" className="mt-4" onClick={() => router.push("/decks")}>
          Back to Decks
        </Button>
      </div>
    );
  }

  const deckColor = deck.color || "#3b82f6";

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-start gap-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => router.push("/decks")}
          className="mt-1"
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>

        <div className="flex-1">
          <div className="flex items-start gap-3">
            <div
              className="w-12 h-12 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{ backgroundColor: `${deckColor}20` }}
            >
              <BookOpen className="h-6 w-6" style={{ color: deckColor }} />
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="text-2xl md:text-3xl font-bold truncate">{deck.name}</h1>
              {deck.description && (
                <p className="text-muted-foreground mt-1 line-clamp-2">
                  {deck.description}
                </p>
              )}
            </div>
          </div>

          {deck.tags && deck.tags.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-3 ml-[3.75rem]">
              {deck.tags.map((tag) => (
                <Badge key={tag} variant="outline" className="text-xs">
                  {tag}
                </Badge>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Cards Section */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">
            Cards ({totalCards ?? cards.length})
          </h2>
          <Button className="gap-2" onClick={() => setIsNewCardOpen(true)}>
            <Plus className="h-4 w-4" />
            New Card
          </Button>
        </div>

        {cardsError && cards.length === 0 && !isLoadingCards ? (
          <Card>
            <CardContent className="py-16 text-center space-y-4">
              <p className="text-muted-foreground">{cardsError}</p>
              <Button
                variant="outline"
                onClick={() => void loadCards(true)}
                className="gap-2"
              >
                Try Again
              </Button>
            </CardContent>
          </Card>
        ) : cards.length === 0 && !isLoadingCards ? (
          <Card>
            <CardContent className="py-16 text-center space-y-4">
              <BookOpen className="h-10 w-10 mx-auto text-muted-foreground/50" />
              <p className="text-muted-foreground">No cards in this deck yet.</p>
              <Button className="gap-2" onClick={() => setIsNewCardOpen(true)}>
                <Plus className="h-4 w-4" />
                Add your first card
              </Button>
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="space-y-3">
              {cards.map((card) => (
                <Card key={card.id} className="hover:shadow-md transition-shadow">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between gap-4">
                      {/* Left "front matter" */}
                      <div className="w-10 flex-shrink-0 text-xs text-muted-foreground font-mono tabular-nums text-left">
                        #{card.sequence}
                      </div>

                      {/* Main content */}
                      <div className="flex-1 min-w-0">
                        <p className="font-medium line-clamp-2">{card.front_content}</p>
                        <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                          {card.back_content}
                        </p>

                        {card.tags && card.tags.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-2">
                            {card.tags.slice(0, 3).map((tag) => (
                              <Badge key={tag} variant="outline" className="text-xs">
                                {tag}
                              </Badge>
                            ))}
                            {card.tags.length > 3 && (
                              <Badge variant="outline" className="text-xs">
                                +{card.tags.length - 3}
                              </Badge>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Middle (date) */}
                      <div className="w-28 flex-shrink-0 text-center text-xs text-muted-foreground tabular-nums">
                        {formatDateYYYYMMDD(card.created_at)}
                      </div>

                      {/* Right actions */}
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <Badge className={card.statusColor}>{card.statusText}</Badge>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onSelect={() => {
                                setSelectedCard(card);
                                setIsEditCardOpen(true);
                              }}
                            >
                              Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem disabled>Export</DropdownMenuItem>
                            <DropdownMenuItem
                              className="text-destructive"
                              onSelect={() => {
                                setSelectedCard(card);
                                setIsDeleteCardOpen(true);
                              }}
                            >
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Load more trigger */}
            <div ref={loadMoreRef} className="py-4 space-y-3">
              {cardsError && (
                <div className="text-center space-y-2">
                  <p className="text-sm text-muted-foreground">{cardsError}</p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void loadCards()}
                    disabled={isLoadingCards}
                  >
                    Try Again
                  </Button>
                </div>
              )}

              {isLoadingCards && (
                <div className="flex items-center justify-center">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              )}

              {/* Fallback button in case IntersectionObserver doesn't fire */}
              {hasMore && !isLoadingCards && !cardsError && cards.length > 0 && (
                <div className="flex justify-center">
                  <Button variant="outline" onClick={() => void loadCards()}>
                    Load more
                  </Button>
                </div>
              )}

              {/* When we've reached the end, don't show extra text. */}
            </div>
          </>
        )}
      </div>

      <NewCardModal
        open={isNewCardOpen}
        onOpenChange={setIsNewCardOpen}
        deckId={deckId}
        onSuccess={() => void loadCards(true)}
      />

      <EditCardModal
        open={isEditCardOpen}
        onOpenChange={setIsEditCardOpen}
        card={selectedCard}
        onSuccess={() => void loadCards(true)}
      />

      <DeleteCardModal
        open={isDeleteCardOpen}
        onOpenChange={setIsDeleteCardOpen}
        card={selectedCard}
        onDeleted={() => void loadCards(true)}
      />
    </div>
  );
}
