"use client";

import { useState } from "react";
import {
  Check,
  X,
  MoreHorizontal,
  Inbox,
  FileText,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

// Mock data
const initialDrafts = [
  {
    id: 1,
    type: "vocabulary",
    front: "Ephemeral",
    back: "Lasting for a very short time. 'The ephemeral nature of fashion trends.'",
    source: "Philosophy 101 - Chapter 3",
    createdAt: "2 hours ago",
    confidence: "high",
  },
  {
    id: 2,
    type: "phrase",
    front: "Carpe diem",
    back: "Seize the day; enjoy the present moment without worry about the future.",
    source: "Latin Reader",
    createdAt: "Yesterday",
    confidence: "medium",
  },
  {
    id: 3,
    type: "vocabulary",
    front: "Ubiquitous",
    back: "Present, appearing, or found everywhere. 'Smartphones have become ubiquitous.'",
    source: "SAT Prep",
    createdAt: "2 days ago",
    confidence: "high",
  },
  {
    id: 4,
    type: "concept",
    front: "Mitochondria",
    back: "The powerhouse of the cell. Generates ATP through cellular respiration.",
    source: "Biology Notes",
    createdAt: "3 days ago",
    confidence: "low",
  },
  {
    id: 5,
    type: "vocabulary",
    front: "Serendipity",
    back: "The occurrence of events by chance in a happy or beneficial way.",
    source: "GRE Vocabulary",
    createdAt: "4 days ago",
    confidence: "medium",
  },
];

export default function RefineryPage() {
  const [drafts, setDrafts] = useState(initialDrafts);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const handleApprove = (id: number) => {
    setDrafts((prev) => prev.filter((d) => d.id !== id));
  };

  const handleReject = (id: number) => {
    setDrafts((prev) => prev.filter((d) => d.id !== id));
  };

  const getConfidenceBadge = (confidence: string) => {
    const styles = {
      high: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
      medium:
        "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
      low: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
    };
    return styles[confidence as keyof typeof styles] || styles.medium;
  };

  if (drafts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4">
        <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center mb-6">
          <Sparkles className="h-10 w-10 text-primary" />
        </div>
        <h2 className="text-2xl font-semibold mb-2">All Caught Up!</h2>
        <p className="text-muted-foreground max-w-md">
          Your refinery is empty. New draft cards will appear here when you
          highlight text while reading.
        </p>
        <Button className="mt-6" variant="outline">
          Learn More
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold flex items-center gap-3">
            <Inbox className="h-7 w-7 text-primary" />
            Refinery
          </h1>
          <p className="text-muted-foreground mt-1">
            {drafts.length} items waiting for review
          </p>
        </div>
        <Button variant="outline" size="sm" className="gap-2">
          <Check className="h-4 w-4" />
          Approve All
        </Button>
      </div>

      {/* Draft Cards */}
      <div className="space-y-3">
        {drafts.map((draft) => (
          <Card
            key={draft.id}
            className={cn(
              "overflow-hidden transition-all duration-300",
              expandedId === draft.id && "ring-2 ring-primary"
            )}
          >
            <CardHeader className="p-4 pb-2">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="secondary" className="text-xs">
                    {draft.type}
                  </Badge>
                  <Badge
                    className={cn(
                      "text-xs border-0",
                      getConfidenceBadge(draft.confidence)
                    )}
                  >
                    {draft.confidence} confidence
                  </Badge>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-8 w-8">
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem>Edit</DropdownMenuItem>
                    <DropdownMenuItem>Change Deck</DropdownMenuItem>
                    <DropdownMenuItem className="text-destructive">
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </CardHeader>

            <CardContent className="p-4 pt-0">
              {/* Front */}
              <div
                className="cursor-pointer"
                onClick={() =>
                  setExpandedId(expandedId === draft.id ? null : draft.id)
                }
              >
                <h3 className="font-serif text-lg font-semibold mb-2">
                  {draft.front}
                </h3>

                {/* Back - conditionally shown */}
                {expandedId === draft.id && (
                  <div className="mt-3 pt-3 border-t border-border">
                    <p className="text-muted-foreground font-serif leading-relaxed">
                      {draft.back}
                    </p>
                  </div>
                )}
              </div>

              {/* Source & Actions */}
              <div className="flex items-center justify-between mt-4 pt-3 border-t border-border/50">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <FileText className="h-3 w-3" />
                  <span>{draft.source}</span>
                  <span>&middot;</span>
                  <span>{draft.createdAt}</span>
                </div>

                {/* Action Buttons */}
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 gap-1 text-destructive hover:text-destructive hover:bg-destructive/10"
                    onClick={() => handleReject(draft.id)}
                  >
                    <X className="h-4 w-4" />
                    <span className="hidden sm:inline">Reject</span>
                  </Button>
                  <Button
                    size="sm"
                    className="h-8 gap-1"
                    onClick={() => handleApprove(draft.id)}
                  >
                    <Check className="h-4 w-4" />
                    <span className="hidden sm:inline">Approve</span>
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
