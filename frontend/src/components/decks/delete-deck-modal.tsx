"use client";

import { useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { decksApi, type Deck } from "@/lib/api/decks";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface DeleteDeckModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deck: Deck;
  onDeleted: (deckId: number) => void;
}

export function DeleteDeckModal({ open, onOpenChange, deck, onDeleted }: DeleteDeckModalProps) {
  const [isDeleting, setIsDeleting] = useState(false);

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && isDeleting) return;
    onOpenChange(nextOpen);
  };

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      await decksApi.deleteDeck(deck.id);
      toast.success("Deck deleted");
      onDeleted(deck.id);
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete deck");
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete deck?</DialogTitle>
          <DialogDescription>
            This will delete <span className="font-medium">{deck.name}</span>. This action cannot be undone.
          </DialogDescription>
        </DialogHeader>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={isDeleting}>
            Cancel
          </Button>
          <Button type="button" variant="destructive" onClick={handleDelete} disabled={isDeleting} className="gap-2">
            {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
