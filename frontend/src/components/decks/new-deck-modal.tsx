"use client";

import { useMemo, useState } from "react";
import { BookOpen, Loader2, Plus, X } from "lucide-react";
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

export const DECK_COLOR_OPTIONS = [
  "#ef4444",
  "#f97316",
  "#f59e0b",
  "#22c55e",
  "#14b8a6",
  "#3b82f6",
  "#6366f1",
  "#8b5cf6",
  "#ec4899",
] as const;

const TITLE_MAX = 60;
const DESCRIPTION_MAX = 140;
const MAX_TAGS = 5;
const TAG_MAX = 20;

interface NewDeckModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (deck: Deck) => void;
}

export function NewDeckModal({ open, onOpenChange, onCreated }: NewDeckModalProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [tagInput, setTagInput] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [color, setColor] = useState<string>(DECK_COLOR_OPTIONS[5]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const trimmedName = useMemo(() => name.trim(), [name]);
  const canSubmit = trimmedName.length > 0 && !isSubmitting;

  const resetForm = () => {
    setName("");
    setDescription("");
    setTagInput("");
    setTags([]);
    setColor(DECK_COLOR_OPTIONS[5]);
    setIsSubmitting(false);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && isSubmitting) {
      return;
    }

    if (!nextOpen) {
      resetForm();
    }

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
      const deck = await decksApi.createDeck({
        name: finalName,
        description: finalDescription || null,
        color: color,
        tags: tags.length > 0 ? tags : null,
      });

      onCreated(deck);
      toast.success("Deck created");
      resetForm();
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to create deck");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create New Deck</DialogTitle>
          <DialogDescription>
            Add a deck with a short description, tags, and a color accent.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="deck-name">Title</Label>
              <span className="text-xs text-muted-foreground">{name.length}/{TITLE_MAX}</span>
            </div>
            <Input
              id="deck-name"
              value={name}
              onChange={(e) => setName(e.target.value.slice(0, TITLE_MAX))}
              placeholder="e.g. Japanese N5"
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
              placeholder="Keep it short and clear"
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
            {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Create Deck
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
