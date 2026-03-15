"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Plus, Save, X } from "lucide-react";
import { toast } from "sonner";
import { type Card, cardsApi } from "@/lib/api/cards";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

const MAX_TAGS = 8;
const TAG_MAX = 24;

function normalizeTag(value: string): string {
  return value.trim();
}

interface EditCardModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  card: Card | null;
  onSuccess?: () => void;
}

export function EditCardModal({ open, onOpenChange, card, onSuccess }: EditCardModalProps) {
  const initialFront = card?.front_content ?? "";
  const initialBack = card?.back_content ?? "";
  const initialTags = useMemo(() => card?.tags ?? [], [card?.tags]);

  const [frontContent, setFrontContent] = useState(initialFront);
  const [backContent, setBackContent] = useState(initialBack);
  const [tagInput, setTagInput] = useState("");
  const [tags, setTags] = useState<string[]>(initialTags);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Keep form in sync when switching which card is being edited.
    setFrontContent(initialFront);
    setBackContent(initialBack);
    setTagInput("");
    setTags(initialTags);
    setError(null);
  }, [initialFront, initialBack, initialTags, open]);

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && isSubmitting) return;
    if (!nextOpen) {
      setError(null);
    }
    onOpenChange(nextOpen);
  };

  const addTagFromInput = () => {
    const tag = normalizeTag(tagInput);
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

    if (!card) {
      setError("No card selected");
      return;
    }

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
      await cardsApi.updateCard(card.id, {
        front_content: frontContent.trim(),
        back_content: backContent.trim(),
        tags,
      });

      toast.success("Card updated");
      onOpenChange(false);
      onSuccess?.();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to update card";
      setError(message);
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[475px]">
        <DialogHeader>
          <DialogTitle>Edit Card</DialogTitle>
          <DialogDescription>Update the card content (and optional tags).</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit}>
          {error && <div className="text-sm text-destructive mb-4">{error}</div>}

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="edit-front-content">Front</Label>
              <Input
                id="edit-front-content"
                value={frontContent}
                onChange={(e) => setFrontContent(e.target.value)}
                disabled={isSubmitting}
                required
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="edit-back-content">Back</Label>
              <Input
                id="edit-back-content"
                value={backContent}
                onChange={(e) => setBackContent(e.target.value)}
                disabled={isSubmitting}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-card-tags">Tags</Label>
              <div className="flex gap-2">
                <Input
                  id="edit-card-tags"
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
                      className="rounded hover:bg-black/10 p-0.5 cursor-pointer disabled:cursor-not-allowed"
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
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting} className="gap-2">
              {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
