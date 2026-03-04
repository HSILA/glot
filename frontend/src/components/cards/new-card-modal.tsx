"use client";

import { useState } from "react";
import { Plus, Loader2 } from "lucide-react";
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
import { cardsApi } from "@/lib/api/cards";

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
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      });

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
