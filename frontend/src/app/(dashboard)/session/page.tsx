"use client";

import { useState } from "react";
import { ArrowLeft, Volume2, Edit, Flag } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

// Mock card data
const mockCard = {
  id: 1,
  front: "Ephemeral",
  back: "Lasting for a very short time; transitory.\n\n'The ephemeral nature of cherry blossoms makes them even more precious.'",
  deckName: "SAT Vocabulary",
  cardNumber: 5,
  totalCards: 23,
};

const ratingButtons = [
  {
    label: "Again",
    shortcut: "1",
    variant: "destructive" as const,
    description: "< 1min",
  },
  {
    label: "Hard",
    shortcut: "2",
    variant: "secondary" as const,
    description: "6min",
  },
  {
    label: "Good",
    shortcut: "3",
    variant: "default" as const,
    description: "10min",
  },
  {
    label: "Easy",
    shortcut: "4",
    variant: "outline" as const,
    description: "4d",
  },
];

export default function SessionPage() {
  const [isFlipped, setIsFlipped] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);

  const handleFlip = () => {
    if (!isAnimating) {
      setIsAnimating(true);
      setIsFlipped(!isFlipped);
      setTimeout(() => setIsAnimating(false), 300);
    }
  };

  const handleRate = (rating: string) => {
    // Reset and show next card
    setIsFlipped(false);
    // In a real app, this would submit the rating and fetch the next card
    console.log("Rated:", rating);
  };

  const progressPercent = (mockCard.cardNumber / mockCard.totalCards) * 100;

  return (
    <div className="flex flex-col min-h-[calc(100vh-8rem)] md:min-h-[calc(100vh-6rem)]">
      {/* Session Header */}
      <div className="flex items-center justify-between mb-4">
        <Link href="/">
          <Button variant="ghost" size="sm" className="gap-2">
            <ArrowLeft className="h-4 w-4" />
            <span className="hidden sm:inline">Exit</span>
          </Button>
        </Link>

        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{mockCard.cardNumber}</span>
          <span>/</span>
          <span>{mockCard.totalCards}</span>
        </div>

        <div className="flex gap-1">
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <Flag className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <Edit className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Progress Bar */}
      <Progress value={progressPercent} className="h-1.5 mb-6" />

      {/* Deck Name */}
      <div className="text-center mb-4">
        <span className="text-sm text-muted-foreground">{mockCard.deckName}</span>
      </div>

      {/* Flashcard - Center Stage */}
      <div className="flex-1 flex items-center justify-center px-4">
        <div
          className="perspective-1000 w-full max-w-lg cursor-pointer"
          onClick={handleFlip}
        >
          <div
            className={cn(
              "relative w-full min-h-[280px] md:min-h-[360px] preserve-3d transition-transform duration-300",
              isFlipped && "rotate-y-180"
            )}
          >
            {/* Front of Card */}
            <Card
              className={cn(
                "absolute inset-0 backface-hidden flex flex-col items-center justify-center p-8 shadow-lg",
                "bg-card border-2 border-border/50"
              )}
            >
              <div className="text-center">
                <h2 className="font-serif text-3xl md:text-4xl font-bold mb-4">
                  {mockCard.front}
                </h2>
                <p className="text-sm text-muted-foreground">
                  Tap to reveal answer
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="absolute top-4 right-4"
                onClick={(e) => {
                  e.stopPropagation();
                  // Play pronunciation
                }}
              >
                <Volume2 className="h-5 w-5" />
              </Button>
            </Card>

            {/* Back of Card */}
            <Card
              className={cn(
                "absolute inset-0 backface-hidden rotate-y-180 flex flex-col items-center justify-center p-8 shadow-lg",
                "bg-card border-2 border-primary/30"
              )}
            >
              <div className="text-center max-w-md">
                <h3 className="font-serif text-2xl md:text-3xl font-bold mb-6 text-primary">
                  {mockCard.front}
                </h3>
                <p className="font-serif text-lg md:text-xl leading-relaxed text-foreground whitespace-pre-line">
                  {mockCard.back}
                </p>
              </div>
            </Card>
          </div>
        </div>
      </div>

      {/* Rating Buttons */}
      <div className="mt-auto pt-6 pb-4">
        {isFlipped ? (
          <div className="grid grid-cols-4 gap-2 max-w-lg mx-auto">
            {ratingButtons.map((btn) => (
              <Button
                key={btn.label}
                variant={btn.variant}
                className={cn(
                  "flex flex-col h-auto py-3 gap-0.5",
                  btn.variant === "default" && "shadow-md"
                )}
                onClick={() => handleRate(btn.label)}
              >
                <span className="text-sm font-medium">{btn.label}</span>
                <span className="text-xs opacity-70">{btn.description}</span>
              </Button>
            ))}
          </div>
        ) : (
          <div className="flex justify-center">
            <Button
              size="lg"
              className="px-12 h-12"
              onClick={handleFlip}
            >
              Show Answer
            </Button>
          </div>
        )}

        {/* Keyboard hints */}
        <p className="text-center text-xs text-muted-foreground mt-4">
          Press <kbd className="px-1.5 py-0.5 bg-muted rounded text-xs">Space</kbd> to flip
          {isFlipped && (
            <>
              {" · "}
              <kbd className="px-1.5 py-0.5 bg-muted rounded text-xs">1-4</kbd> to rate
            </>
          )}
        </p>
      </div>
    </div>
  );
}
