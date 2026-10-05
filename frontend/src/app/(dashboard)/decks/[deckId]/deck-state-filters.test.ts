import { expect, test } from "bun:test";
import { DECK_STATE_FILTERS } from "./deck-state-filters";

test("deck filters offer All, New, Learning, and Review only", () => {
  expect(DECK_STATE_FILTERS).toEqual([
    { value: "all", label: "All" },
    { value: "new", label: "New" },
    { value: "learning", label: "Learning" },
    { value: "review", label: "Review" },
  ]);
});
