import type { CardState } from "@/lib/api/cards";

export const DECK_STATE_FILTERS: readonly {
  value: CardState | "all";
  label: string;
}[] = [
  { value: "all", label: "All" },
  { value: "new", label: "New" },
  { value: "learning", label: "Learning" },
  { value: "review", label: "Review" },
];
