"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Save } from "lucide-react";
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

function parseTags(value: string): string[] {
  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function formatTags(tags: string[] | null | undefined): string {
  return (tags ?? []).join(", ");
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
  const initialTags = useMemo(() => formatTags(card?.tags), [card?.tags]);

  const [frontContent, setFrontContent] = useState(initialFront);
  const [backContent, setBackContent] = useState(initialBack);
  const [tags, setTags] = useState(initialTags);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Keep form in sync when switching which card is being edited.
    setFrontContent(initialFront);
    setBackContent(initialBack);
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
        tags: parseTags(tags),
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

            <div className="grid gap-2">
              <Label htmlFor="edit-card-tags">Tags (comma-separated)</Label>
              <Input
                id="edit-card-tags"
                placeholder="e.g. math, calculus"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                disabled={isSubmitting}
              />
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
