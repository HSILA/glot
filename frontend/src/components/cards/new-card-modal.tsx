"use client";

import { useState } from "react";
import { Plus, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cardsApi } from "@/lib/api/cards";

const MAX_TAGS = 8;
const TAG_MAX = 24;

interface NewCardModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deckId: number;
  onSuccess?: () => void;
}

export function NewCardModal({
  open,
  onOpenChange,
  deckId,
  onSuccess,
}: NewCardModalProps) {
  const [frontContent, setFrontContent] = useState("");
  const [backContent, setBackContent] = useState("");
  const [tagInput, setTagInput] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addTagFromInput = () => {
    const tag = tagInput.trim();
    if (!tag) return;

    if (tag.length > TAG_MAX) {
      toast.error(`Tags must be ${TAG_MAX} characters or less.`);
      return;
    }

    if (tags.length >= MAX_TAGS) {
      toast.error(`You can add up to ${MAX_TAGS} tags.`);
      return;
    }

    if (tags.some((existing) => existing.toLowerCase() === tag.toLowerCase())) {
      toast.error("Tag already added.");
      return;
    }

    setTags((prev) => [...prev, tag]);
    setTagInput("");
  };

  const removeTag = (tagToRemove: string) => {
    setTags((prev) => prev.filter((tag) => tag !== tagToRemove));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!frontContent.trim()) {
      setError("Front content is required");
      return;
    }

    if (!backContent.trim()) {
      setError("Back content is required");
      return;
    }

    setIsSubmitting(true);

    try {
      await cardsApi.createCard({
        deck_id: deckId,
        front_content: frontContent.trim(),
        back_content: backContent.trim(),
        tags,
      });

      toast.success("Card created");
      setFrontContent("");
      setBackContent("");
      onOpenChange(false);
      onSuccess?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create card");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      setFrontContent("");
      setBackContent("");
      setTagInput("");
      setTags([]);
      setError(null);
    }
    onOpenChange(newOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>New Card</DialogTitle>
          <DialogDescription>
            Add a new flashcard to this deck
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          {error && (
            <div className="text-sm text-destructive mb-4">{error}</div>
          )}
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="front-content">Front</Label>
              <Input
                id="front-content"
                placeholder="Question or prompt"
                value={frontContent}
                onChange={(e) => setFrontContent(e.target.value)}
                disabled={isSubmitting}
                required
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="back-content">Back</Label>
              <Input
                id="back-content"
                placeholder="Answer or response"
                value={backContent}
                onChange={(e) => setBackContent(e.target.value)}
                disabled={isSubmitting}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="card-tags">Tags</Label>
              <div className="flex gap-2">
                <Input
                  id="card-tags"
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === ",") {
                      e.preventDefault();
                      addTagFromInput();
                    }
                  }}
                  placeholder="Press Enter to add tag"
                  maxLength={TAG_MAX}
                  disabled={isSubmitting || tags.length >= MAX_TAGS}
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={addTagFromInput}
                  disabled={isSubmitting || !tagInput.trim() || tags.length >= MAX_TAGS}
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>

              <div className="flex flex-wrap gap-2 min-h-6">
                {tags.map((tag) => (
                  <Badge key={tag} variant="secondary" className="gap-1 pr-1">
                    {tag}
                    <button
                      type="button"
                      onClick={() => removeTag(tag)}
                      className="rounded hover:bg-black/10 p-0.5"
                      aria-label={`Remove tag ${tag}`}
                      disabled={isSubmitting}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>

              <p className="text-xs text-muted-foreground">Up to {MAX_TAGS} tags.</p>
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting} className="gap-2">
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <Plus className="h-4 w-4" />
                  Create Card
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
