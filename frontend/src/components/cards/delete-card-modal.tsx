"use client";

import { useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
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

interface DeleteCardModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  card: Card | null;
  onDeleted?: () => void;
}

export function DeleteCardModal({ open, onOpenChange, card, onDeleted }: DeleteCardModalProps) {
  const [isDeleting, setIsDeleting] = useState(false);

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && isDeleting) return;
    onOpenChange(nextOpen);
  };

  const handleDelete = async () => {
    if (!card) return;

    setIsDeleting(true);
    try {
      await cardsApi.deleteCard(card.id);
      toast.success("Card deleted");
      onOpenChange(false);
      onDeleted?.();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to delete card";
      toast.error(message);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete card?</DialogTitle>
          <DialogDescription>
            This will delete card <span className="font-mono">#{card?.sequence ?? "—"}</span>. This action cannot be undone.
          </DialogDescription>
        </DialogHeader>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={isDeleting}>
            Cancel
          </Button>
          <Button type="button" variant="destructive" onClick={handleDelete} disabled={isDeleting || !card} className="gap-2">
            {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
