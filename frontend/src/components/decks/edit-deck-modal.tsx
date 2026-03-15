"use client";

import { useEffect, useMemo, useState } from "react";
import { BookOpen, Loader2, Save, X } from "lucide-react";
import { toast } from "sonner";
import { decksApi, type Deck } from "@/lib/api/decks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DECK_COLOR_OPTIONS } from "@/components/decks/new-deck-modal";

const TITLE_MAX = 60;
const DESCRIPTION_MAX = 140;
const MAX_TAGS = 5;
const TAG_MAX = 20;

interface EditDeckModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deck: Deck;
  onUpdated: (deck: Deck) => void;
}

export function EditDeckModal({ open, onOpenChange, deck, onUpdated }: EditDeckModalProps) {
  const [name, setName] = useState(deck.name);
  const [description, setDescription] = useState(deck.description ?? "");
  const [tagInput, setTagInput] = useState("");
  const [tags, setTags] = useState<string[]>(deck.tags ?? []);
  const [color, setColor] = useState<string>(deck.color ?? DECK_COLOR_OPTIONS[5]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(deck.name);
    setDescription(deck.description ?? "");
    setTagInput("");
    setTags(deck.tags ?? []);
    setColor(deck.color ?? DECK_COLOR_OPTIONS[5]);
    setIsSubmitting(false);
  }, [open, deck]);

  const trimmedName = useMemo(() => name.trim(), [name]);
  const canSubmit = trimmedName.length > 0 && !isSubmitting;

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && isSubmitting) return;
    onOpenChange(nextOpen);
  };

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

  const handleSubmit = async () => {
    const finalName = trimmedName;
    const finalDescription = description.trim();

    if (!finalName) {
      toast.error("Title is required.");
      return;
    }

    if (finalName.length > TITLE_MAX) {
      toast.error(`Title must be ${TITLE_MAX} characters or less.`);
      return;
    }

    if (finalDescription.length > DESCRIPTION_MAX) {
      toast.error(`Description must be ${DESCRIPTION_MAX} characters or less.`);
      return;
    }

    setIsSubmitting(true);

    try {
      const updated = await decksApi.updateDeck(deck.id, {
        name: finalName,
        description: finalDescription || null,
        color,
        tags: tags.length > 0 ? tags : null,
      });

      onUpdated(updated);
      toast.success("Deck updated");
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update deck");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Deck</DialogTitle>
          <DialogDescription>Update title, description, tags, and color.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="deck-name">Title</Label>
              <span className="text-xs text-muted-foreground">
                {name.length}/{TITLE_MAX}
              </span>
            </div>
            <Input
              id="deck-name"
              value={name}
              onChange={(e) => setName(e.target.value.slice(0, TITLE_MAX))}
              maxLength={TITLE_MAX}
              disabled={isSubmitting}
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="deck-description">Short description</Label>
              <span className="text-xs text-muted-foreground">
                {description.length}/{DESCRIPTION_MAX}
              </span>
            </div>
            <Input
              id="deck-description"
              value={description}
              onChange={(e) => setDescription(e.target.value.slice(0, DESCRIPTION_MAX))}
              maxLength={DESCRIPTION_MAX}
              disabled={isSubmitting}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="deck-tags">Tags</Label>
            <div className="flex gap-2">
              <Input
                id="deck-tags"
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
                Add
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

          <div className="space-y-2">
            <Label>Deck color</Label>
            <div className="flex flex-wrap gap-2">
              {DECK_COLOR_OPTIONS.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setColor(option)}
                  className={`h-8 w-8 rounded-md border transition cursor-pointer disabled:cursor-not-allowed ${
                    color === option ? "ring-2 ring-primary ring-offset-1" : ""
                  }`}
                  style={{ backgroundColor: option }}
                  aria-label={`Select color ${option}`}
                  disabled={isSubmitting}
                />
              ))}
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <BookOpen className="h-4 w-4" style={{ color }} />
              Preview icon color
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={!canSubmit} className="gap-2">
            {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
