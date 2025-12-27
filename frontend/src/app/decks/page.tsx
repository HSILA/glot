"use client";

import { useState } from "react";
import {
  Plus,
  Layers,
  ChevronRight,
  MoreHorizontal,
  Play,
  BookOpen,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// Mock data
const decks = [
  {
    id: 1,
    name: "Japanese N5",
    description: "JLPT N5 vocabulary and grammar",
    color: "#ef4444",
    totalCards: 250,
    newCards: 15,
    dueCards: 23,
    masteredCards: 180,
    lastStudied: "Today",
  },
  {
    id: 2,
    name: "Medical Terms",
    description: "Anatomy and medical vocabulary",
    color: "#3b82f6",
    totalCards: 500,
    newCards: 45,
    dueCards: 12,
    masteredCards: 320,
    lastStudied: "Yesterday",
  },
  {
    id: 3,
    name: "Philosophy",
    description: "Key concepts and thinkers",
    color: "#8b5cf6",
    totalCards: 180,
    newCards: 8,
    dueCards: 28,
    masteredCards: 95,
    lastStudied: "2 days ago",
  },
  {
    id: 4,
    name: "Spanish B2",
    description: "Intermediate Spanish vocabulary",
    color: "#f59e0b",
    totalCards: 800,
    newCards: 100,
    dueCards: 5,
    masteredCards: 650,
    lastStudied: "Today",
  },
  {
    id: 5,
    name: "Data Structures",
    description: "Algorithms and complexity",
    color: "#10b981",
    totalCards: 120,
    newCards: 20,
    dueCards: 18,
    masteredCards: 65,
    lastStudied: "3 days ago",
  },
];

export default function DecksPage() {
  const totalDue = decks.reduce((sum, deck) => sum + deck.dueCards, 0);

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Page Header */}
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
        <Button className="gap-2 w-full md:w-auto">
          <Plus className="h-4 w-4" />
          New Deck
        </Button>
      </div>

      {/* Quick Study All Due */}
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
            <Button className="w-full sm:w-auto gap-2">
              <Play className="h-4 w-4" />
              Study All Due
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Decks Grid */}
      <div className="grid gap-4 md:grid-cols-2">
        {decks.map((deck) => {
          const masteryPercent = Math.round(
            (deck.masteredCards / deck.totalCards) * 100
          );
          return (
            <Card
              key={deck.id}
              className="group cursor-pointer hover:shadow-lg transition-all duration-300 hover:-translate-y-0.5"
            >
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div
                      className="w-10 h-10 rounded-lg flex items-center justify-center"
                      style={{ backgroundColor: `${deck.color}20` }}
                    >
                      <BookOpen
                        className="h-5 w-5"
                        style={{ color: deck.color }}
                      />
                    </div>
                    <div>
                      <CardTitle className="text-lg group-hover:text-primary transition-colors">
                        {deck.name}
                      </CardTitle>
                      <p className="text-sm text-muted-foreground">
                        {deck.description}
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
                      <DropdownMenuItem>Edit</DropdownMenuItem>
                      <DropdownMenuItem>Export</DropdownMenuItem>
                      <DropdownMenuItem className="text-destructive">
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </CardHeader>

              <CardContent className="pt-0">
                {/* Stats */}
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

                {/* Mastery Progress */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Mastery</span>
                    <span className="font-medium">{masteryPercent}%</span>
                  </div>
                  <Progress
                    value={masteryPercent}
                    className="h-2"
                    style={
                      {
                        "--tw-progress-color": deck.color,
                      } as React.CSSProperties
                    }
                  />
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between mt-4 pt-3 border-t border-border/50">
                  <span className="text-xs text-muted-foreground">
                    Last studied: {deck.lastStudied}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 gap-1 text-primary"
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
    </div>
  );
}
