"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  Layers,
  ChevronRight,
  MoreHorizontal,
  Play,
  BookOpen,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { decksApi, type Deck } from "@/lib/api/decks";
import { cardsApi, type Card as FlashCard } from "@/lib/api/cards";
import {
  DECK_COLOR_OPTIONS,
  NewDeckModal,
} from "@/components/decks/new-deck-modal";

type DeckWithStats = Omit<Deck, 'color'> & {
  color: string;
  totalCards: number;
  newCards: number;
  dueCards: number;
  lastStudied: string;
};

function formatLastStudied(lastReviewedAt: string | null): string {
  if (!lastReviewedAt) return "Never";

  const ts = new Date(lastReviewedAt).getTime();
  if (Number.isNaN(ts)) return "Unknown";

  const days = Math.floor((Date.now() - ts) / (1000 * 60 * 60 * 24));

  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  return `${days} days ago`;
}

function colorForDeck(deck: Deck): string {
  if (deck.color) return deck.color;
  return DECK_COLOR_OPTIONS[(deck.id - 1) % DECK_COLOR_OPTIONS.length];
}

function computeDeckStats(cards: FlashCard[]) {
  const now = Date.now();
  let lastReviewAt: string | null = null;

  const dueCards = cards.filter((card) => {
    if (card.state === "new") return true;
    if (!card.next_review_at) return false;
    const nextTs = new Date(card.next_review_at).getTime();
    return !Number.isNaN(nextTs) && nextTs <= now;
  }).length;

  for (const card of cards) {
    if (!card.last_review_at) continue;
    if (!lastReviewAt || new Date(card.last_review_at) > new Date(lastReviewAt)) {
      lastReviewAt = card.last_review_at;
    }
  }

  return {
    totalCards: cards.length,
    newCards: cards.filter((card) => card.state === "new").length,
    dueCards,
    lastStudied: formatLastStudied(lastReviewAt),
  };
}

async function listAllDecks(): Promise<Deck[]> {
  const allDecks: Deck[] = [];
  const limit = 100;
  let offset = 0;

  while (true) {
    const page = await decksApi.listDecks({ limit, offset });
    allDecks.push(...page);

    if (page.length < limit) {
      break;
    }

    offset += limit;
  }

  return allDecks;
}

async function listAllCards(): Promise<FlashCard[]> {
  const allCards: FlashCard[] = [];
  const limit = 200;
  let offset = 0;

  while (true) {
    const page = await cardsApi.listCards({ limit, offset });
    allCards.push(...page);

    if (page.length < limit) {
      break;
    }

    offset += limit;
  }

  return allCards;
}

export default function DecksPage() {
  const router = useRouter();

  const [decks, setDecks] = useState<DeckWithStats[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isCreateDeckOpen, setIsCreateDeckOpen] = useState(false);

  const requestIdRef = useRef(0);

  const loadDecks = useCallback(async () => {
    const requestId = ++requestIdRef.current;

    setIsLoading(true);
    setError(null);

    try {
      const [userDecks, allCards] = await Promise.all([listAllDecks(), listAllCards()]);

      const cardsByDeck = new Map<number, FlashCard[]>();
      for (const card of allCards) {
        if (card.deck_id === null) continue;
        const arr = cardsByDeck.get(card.deck_id) ?? [];
        arr.push(card);
        cardsByDeck.set(card.deck_id, arr);
      }

      const decksWithStats = userDecks.map((deck) => {
        const cards = cardsByDeck.get(deck.id) ?? [];

        return {
          ...deck,
          color: colorForDeck(deck),
          ...computeDeckStats(cards),
        };
      });

      if (requestId !== requestIdRef.current) return;
      setDecks(decksWithStats);
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      setError(err instanceof Error ? err.message : "Failed to load decks");
    } finally {
      if (requestId === requestIdRef.current) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void loadDecks();

    return () => {
      requestIdRef.current += 1;
    };
  }, [loadDecks]);

  const totalDue = useMemo(
    () => decks.reduce((sum, deck) => sum + deck.dueCards, 0),
    [decks]
  );

  const handleDeckCreated = async () => {
    await loadDecks();
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-20">
        <p className="text-muted-foreground">{error}</p>
        <Button variant="outline" className="mt-4" onClick={() => void loadDecks()}>
          Try Again
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold flex items-center gap-3">
            <Layers className="h-7 w-7 text-primary" />
            Decks
          </h1>
          <p className="text-muted-foreground mt-1">
            {decks.length} decks &middot; {totalDue} cards due today
          </p>
        </div>
        <Button className="gap-2 w-full md:w-auto" onClick={() => setIsCreateDeckOpen(true)}>
          <Plus className="h-4 w-4" />
          New Deck
        </Button>
      </div>

      {totalDue > 0 && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="p-4 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center">
                <Play className="h-6 w-6 text-primary" />
              </div>
              <div>
                <h3 className="font-semibold">Ready to study?</h3>
                <p className="text-sm text-muted-foreground">
                  You have {totalDue} cards due across all decks
                </p>
              </div>
            </div>
            {/* TODO(session): Wire this to live session filtering once session page reads query params and backend due data. */}
            <Button className="w-full sm:w-auto gap-2" onClick={() => router.push("/session") }>
              <Play className="h-4 w-4" />
              Study All Due
            </Button>
          </CardContent>
        </Card>
      )}

      {decks.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center space-y-4">
            <BookOpen className="h-10 w-10 mx-auto text-muted-foreground/50" />
            <p className="text-muted-foreground">No decks yet.</p>
            <Button onClick={() => setIsCreateDeckOpen(true)} className="gap-2">
              <Plus className="h-4 w-4" />
              Create your first deck
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {decks.map((deck) => {
            return (
              <Card
                key={deck.id}
                role="link"
                tabIndex={0}
                aria-label={`Open deck ${deck.name}`}
                className="group cursor-pointer hover:shadow-lg transition-all duration-300 hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                onClick={() => router.push(`/decks/${deck.id}`)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    router.push(`/decks/${deck.id}`);
                  }
                }}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className="w-10 h-10 rounded-lg flex items-center justify-center"
                        style={{ backgroundColor: `${deck.color}20` }}
                      >
                        <BookOpen className="h-5 w-5" style={{ color: deck.color }} />
                      </div>
                      <div className="min-w-0">
                        <CardTitle className="text-lg group-hover:text-primary transition-colors truncate">
                          {deck.name}
                        </CardTitle>
                        <p className="text-sm text-muted-foreground line-clamp-2">
                          {deck.description || "No description"}
                        </p>
                      </div>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem disabled>Edit</DropdownMenuItem>
                        <DropdownMenuItem disabled>Export</DropdownMenuItem>
                        <DropdownMenuItem className="text-destructive" disabled>
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </CardHeader>

                <CardContent className="pt-0">
                  {deck.tags && deck.tags.length > 0 && (
                    <div className="flex flex-wrap gap-2 mb-3">
                      {deck.tags.slice(0, 4).map((tag) => (
                        <Badge key={tag} variant="outline" className="text-xs">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  )}

                  <div className="flex items-center gap-2 mb-3">
                    <Badge
                      variant="secondary"
                      className="text-xs bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                    >
                      {deck.newCards} new
                    </Badge>
                    <Badge
                      variant="secondary"
                      className="text-xs bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400"
                    >
                      {deck.dueCards} due
                    </Badge>
                    <span className="text-xs text-muted-foreground ml-auto">
                      {deck.totalCards} total
                    </span>
                  </div>

                  <div className="flex items-center justify-between mt-4 pt-3 border-t border-border/50">
                    <span className="text-xs text-muted-foreground">
                      Last studied: {deck.lastStudied}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 gap-1 text-primary"
                      onClick={(e) => {
                        e.stopPropagation();
                        router.push(`/session?deck_id=${deck.id}`);
                      }}
                    >
                      Study
                      <ChevronRight className="h-3 w-3" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <NewDeckModal
        open={isCreateDeckOpen}
        onOpenChange={setIsCreateDeckOpen}
        onCreated={handleDeckCreated}
      />
    </div>
  );
}
