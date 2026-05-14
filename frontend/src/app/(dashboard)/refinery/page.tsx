"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Icon } from "@/components/glot/icon";

// Mock data (preserved from prior implementation)
const initialDrafts = [
  {
    id: 1,
    type: "vocabulary",
    front: "Ephemeral",
    back: "Lasting for a very short time. 'The ephemeral nature of fashion trends.'",
    hints: "Latin: ephemerus, lasting a day.",
    tags: ["vocab", "english"],
    source: "Philosophy 101 - Chapter 3",
    createdAt: "2 hours ago",
    confidence: "high" as const,
  },
  {
    id: 2,
    type: "phrase",
    front: "Carpe diem",
    back: "Seize the day; enjoy the present moment without worry about the future.",
    hints: "Horace, Odes I.11.",
    tags: ["latin", "idiom"],
    source: "Latin Reader",
    createdAt: "Yesterday",
    confidence: "medium" as const,
  },
  {
    id: 3,
    type: "vocabulary",
    front: "Ubiquitous",
    back: "Present, appearing, or found everywhere. 'Smartphones have become ubiquitous.'",
    hints: "From Latin ubique = everywhere.",
    tags: ["vocab", "sat"],
    source: "SAT Prep",
    createdAt: "2 days ago",
    confidence: "high" as const,
  },
  {
    id: 4,
    type: "concept",
    front: "Mitochondria",
    back: "The powerhouse of the cell. Generates ATP through cellular respiration.",
    hints: "Double-membraned organelles with their own DNA.",
    tags: ["biology"],
    source: "Biology Notes",
    createdAt: "3 days ago",
    confidence: "low" as const,
  },
  {
    id: 5,
    type: "vocabulary",
    front: "Serendipity",
    back: "The occurrence of events by chance in a happy or beneficial way.",
    hints: "Coined by Horace Walpole, 1754.",
    tags: ["vocab", "etymology"],
    source: "GRE Vocabulary",
    createdAt: "4 days ago",
    confidence: "medium" as const,
  },
];

const mockDecks = [
  { id: 1, name: "SAT Vocabulary", color: "#c5a3ff" },
  { id: 2, name: "Latin Reader", color: "#ff8a6b" },
  { id: 3, name: "Biology 101", color: "#88d4ff" },
  { id: 4, name: "Philosophy", color: "#d4ff3a" },
];

type Draft = (typeof initialDrafts)[number];

export default function RefineryPage() {
  const [drafts, setDrafts] = useState<Draft[]>(initialDrafts);
  const [selectedId, setSelectedId] = useState<number | null>(initialDrafts[0]?.id ?? null);
  const [sourceInput, setSourceInput] = useState("");
  const [targetDeckId, setTargetDeckId] = useState<number>(mockDecks[0].id);

  const selected = useMemo(
    () => drafts.find((d) => d.id === selectedId) ?? null,
    [drafts, selectedId]
  );

  const handleApprove = (id: number) => {
    const idx = drafts.findIndex((d) => d.id === id);
    const next = drafts.filter((d) => d.id !== id);
    setDrafts(next);
    if (next.length > 0) {
      const nextIdx = Math.min(idx, next.length - 1);
      setSelectedId(next[nextIdx].id);
    } else {
      setSelectedId(null);
    }
  };

  const handleReject = (id: number) => handleApprove(id);

  const updateSelected = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    if (!selected) return;
    setDrafts((prev) =>
      prev.map((d) => (d.id === selected.id ? { ...d, [key]: value } : d))
    );
  };

  const confidencePill = (confidence: Draft["confidence"]) => {
    if (confidence === "high") return "good";
    if (confidence === "medium") return "warn";
    return "bad";
  };

  const selectedDeck = mockDecks.find((d) => d.id === targetDeckId) ?? mockDecks[0];

  if (drafts.length === 0) {
    return (
      <div className="max-w-3xl mx-auto pt-12">
        <div className="glot-card p-16 text-center grid-bg">
          <div
            className="inline-flex items-center justify-center mb-6"
            style={{
              width: 72,
              height: 72,
              borderRadius: 16,
              background: "var(--surface-1)",
              border: "1px solid var(--line)",
              color: "var(--accent)",
            }}
          >
            <Icon name="sparkle" size={32} />
          </div>
          <h2
            className="serif"
            style={{ fontSize: 32, fontWeight: 500, letterSpacing: "-0.02em" }}
          >
            Refinery is empty
          </h2>
          <p
            className="mt-3 mx-auto max-w-md"
            style={{ color: "var(--muted)", fontSize: 14 }}
          >
            Highlight text while reading, or paste a passage below to generate cards.
          </p>
          <div className="max-w-xl mx-auto mt-6">
            <textarea
              placeholder="Paste source text here…"
              className="w-full rounded-lg p-4 outline-none focus-glow"
              style={{
                background: "var(--bg-1)",
                border: "1px solid var(--line)",
                color: "var(--fg)",
                fontSize: 14,
                minHeight: 100,
                fontFamily: "var(--sans)",
                resize: "vertical",
              }}
            />
            <Button className="mt-3 gap-2">
              <Icon name="sparkle" size={14} />
              Generate cards
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6 pb-8">
      {/* Header */}
      <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
        <div>
          <div
            className="mono"
            style={{ fontSize: 11, color: "var(--accent)", letterSpacing: "0.12em" }}
          >
            REFINERY
            <span
              className="mono"
              style={{ marginLeft: 8, color: "var(--muted)", letterSpacing: "0.06em" }}
            >
              AI · DRAFT QUEUE
            </span>
          </div>
          <h1
            className="serif mt-2"
            style={{
              fontSize: "clamp(36px, 5vw, 48px)",
              fontWeight: 500,
              lineHeight: 1,
              letterSpacing: "-0.03em",
            }}
          >
            Refine drafts
          </h1>
          <p className="mt-2" style={{ color: "var(--muted)", fontSize: 14 }}>
            {drafts.length} item{drafts.length === 1 ? "" : "s"} waiting for your review.
          </p>
        </div>
        <Button variant="outline" className="gap-2 self-start">
          <Icon name="check" size={14} />
          Approve all
        </Button>
      </header>

      {/* Two-pane layout */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        {/* Left: queue */}
        <aside className="space-y-3 order-2 lg:order-1">
          {/* New source input */}
          <div className="glot-card p-4">
            <div
              className="mono mb-2"
              style={{ fontSize: 10, color: "var(--muted)", letterSpacing: "0.12em" }}
            >
              <Icon name="sparkle" size={11} style={{ display: "inline", verticalAlign: "-2px", marginRight: 4 }} />
              FEED THE MACHINE
            </div>
            <textarea
              value={sourceInput}
              onChange={(e) => setSourceInput(e.target.value)}
              placeholder="Paste a passage, link, or note…"
              className="w-full rounded-lg p-3 outline-none focus-glow text-sm"
              style={{
                background: "var(--bg-1)",
                border: "1px solid var(--line)",
                color: "var(--fg)",
                fontFamily: "var(--sans)",
                minHeight: 76,
                resize: "vertical",
              }}
            />
            <Button
              className="w-full mt-2 gap-2"
              size="sm"
              disabled={sourceInput.trim().length === 0}
            >
              <Icon name="sparkle" size={12} />
              Generate cards
            </Button>
          </div>

          {/* Queue list */}
          <div className="space-y-2">
            <div
              className="mono px-1"
              style={{ fontSize: 10, color: "var(--muted-2)", letterSpacing: "0.12em" }}
            >
              QUEUE
            </div>
            <div className="space-y-1.5">
              {drafts.map((draft) => {
                const active = draft.id === selectedId;
                return (
                  <button
                    key={draft.id}
                    onClick={() => setSelectedId(draft.id)}
                    className="w-full text-left p-3 rounded-lg group transition-colors"
                    style={{
                      background: active ? "var(--surface-1)" : "var(--surface)",
                      border: `1px solid ${
                        active ? "var(--line-2)" : "var(--line)"
                      }`,
                      position: "relative",
                    }}
                  >
                    {active && (
                      <span
                        aria-hidden
                        style={{
                          position: "absolute",
                          left: -1,
                          top: 10,
                          bottom: 10,
                          width: 2,
                          background: "var(--accent)",
                          borderRadius: 2,
                        }}
                      />
                    )}
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="pill outline" style={{ fontSize: 10 }}>
                        {draft.type}
                      </span>
                      <span
                        className={`pill ${confidencePill(draft.confidence)}`}
                        style={{ fontSize: 10 }}
                      >
                        {draft.confidence}
                      </span>
                    </div>
                    <div
                      className="serif"
                      style={{
                        fontSize: 16,
                        fontWeight: 500,
                        letterSpacing: "-0.01em",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {draft.front}
                    </div>
                    <div
                      className="mono mt-1 flex items-center gap-1.5"
                      style={{ fontSize: 10, color: "var(--muted-2)", letterSpacing: "0.04em" }}
                    >
                      <Icon name="pdf" size={10} />
                      <span className="truncate">{draft.source}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </aside>

        {/* Right: editor */}
        <section className="order-1 lg:order-2">
          {selected ? (
            <div className="glot-card p-6 md:p-7 space-y-5">
              {/* Header */}
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2">
                  <span className="pill outline">{selected.type}</span>
                  <span className={`pill ${confidencePill(selected.confidence)}`}>
                    {selected.confidence} confidence
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" aria-label="More">
                        <Icon name="more" size={15} />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem>Regenerate</DropdownMenuItem>
                      <DropdownMenuItem>Move to another deck</DropdownMenuItem>
                      <DropdownMenuItem className="text-destructive">
                        Discard
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>

              {/* Front field */}
              <FieldGroup label="Front" hint="The prompt you'll see during review.">
                <input
                  type="text"
                  value={selected.front}
                  onChange={(e) => updateSelected("front", e.target.value)}
                  className="w-full rounded-lg px-4 py-3 outline-none focus-glow serif"
                  style={{
                    background: "var(--bg-1)",
                    border: "1px solid var(--line)",
                    color: "var(--fg)",
                    fontSize: 22,
                    fontWeight: 500,
                    letterSpacing: "-0.02em",
                  }}
                />
              </FieldGroup>

              {/* Back field */}
              <FieldGroup label="Back" hint="The answer or explanation.">
                <textarea
                  value={selected.back}
                  onChange={(e) => updateSelected("back", e.target.value)}
                  className="w-full rounded-lg px-4 py-3 outline-none focus-glow"
                  style={{
                    background: "var(--bg-1)",
                    border: "1px solid var(--line)",
                    color: "var(--fg)",
                    fontFamily: "var(--serif)",
                    fontSize: 16,
                    lineHeight: 1.5,
                    minHeight: 110,
                    resize: "vertical",
                  }}
                />
              </FieldGroup>

              {/* Hints */}
              <FieldGroup label="Hints" hint="Optional context, shown on demand.">
                <input
                  type="text"
                  value={selected.hints}
                  onChange={(e) => updateSelected("hints", e.target.value)}
                  className="w-full rounded-lg px-4 py-2.5 outline-none focus-glow text-sm"
                  style={{
                    background: "var(--bg-1)",
                    border: "1px solid var(--line)",
                    color: "var(--fg)",
                  }}
                />
              </FieldGroup>

              {/* Tags */}
              <FieldGroup label="Tags" hint="Comma-separated.">
                <div
                  className="flex flex-wrap gap-2 px-3 py-2 rounded-lg"
                  style={{
                    background: "var(--bg-1)",
                    border: "1px solid var(--line)",
                    minHeight: 40,
                  }}
                >
                  {selected.tags.map((tag) => (
                    <span
                      key={tag}
                      className="pill outline"
                      style={{ paddingRight: 6 }}
                    >
                      {tag}
                      <button
                        aria-label={`Remove ${tag}`}
                        onClick={() =>
                          updateSelected(
                            "tags",
                            selected.tags.filter((t) => t !== tag)
                          )
                        }
                        style={{
                          background: "transparent",
                          border: "none",
                          cursor: "pointer",
                          color: "inherit",
                          opacity: 0.6,
                          padding: 0,
                          marginLeft: 2,
                          display: "inline-flex",
                        }}
                      >
                        <Icon name="close" size={10} />
                      </button>
                    </span>
                  ))}
                  <input
                    type="text"
                    placeholder="Add tag…"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === ",") {
                        e.preventDefault();
                        const v = (e.currentTarget.value || "").trim();
                        if (v && !selected.tags.includes(v)) {
                          updateSelected("tags", [...selected.tags, v]);
                        }
                        e.currentTarget.value = "";
                      }
                    }}
                    className="bg-transparent outline-none text-sm flex-1 min-w-[100px]"
                    style={{ color: "var(--fg)" }}
                  />
                </div>
              </FieldGroup>

              {/* Source */}
              <div
                className="rounded-lg p-3 flex items-center gap-3"
                style={{
                  background: "var(--surface-1)",
                  border: "1px solid var(--line)",
                }}
              >
                <div
                  className="grid place-items-center flex-shrink-0"
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 6,
                    background: "var(--surface-2)",
                    color: "var(--muted)",
                  }}
                >
                  <Icon name="pdf" size={14} />
                </div>
                <div className="min-w-0 flex-1">
                  <div
                    className="mono"
                    style={{ fontSize: 10, color: "var(--muted-2)", letterSpacing: "0.1em" }}
                  >
                    SOURCE
                  </div>
                  <div
                    style={{
                      fontSize: 13,
                      color: "var(--fg)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {selected.source}
                  </div>
                </div>
                <div
                  className="mono hidden sm:block"
                  style={{ fontSize: 11, color: "var(--muted)" }}
                >
                  {selected.createdAt}
                </div>
              </div>

              {/* Deck assignment + actions */}
              <div
                className="pt-5 mt-2 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
                style={{ borderTop: "1px solid var(--line)" }}
              >
                <div className="flex items-center gap-2">
                  <span
                    className="mono"
                    style={{
                      fontSize: 10,
                      color: "var(--muted)",
                      letterSpacing: "0.1em",
                    }}
                  >
                    DESTINATION
                  </span>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="sm" className="gap-2">
                        <span
                          aria-hidden
                          style={{
                            width: 10,
                            height: 10,
                            borderRadius: 3,
                            background: selectedDeck.color,
                            display: "inline-block",
                          }}
                        />
                        {selectedDeck.name}
                        <Icon name="chevD" size={11} />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      {mockDecks.map((d) => (
                        <DropdownMenuItem
                          key={d.id}
                          onClick={() => setTargetDeckId(d.id)}
                        >
                          <span
                            aria-hidden
                            style={{
                              width: 10,
                              height: 10,
                              borderRadius: 3,
                              background: d.color,
                              display: "inline-block",
                              marginRight: 8,
                            }}
                          />
                          {d.name}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    onClick={() => handleReject(selected.id)}
                    className="gap-2"
                  >
                    <Icon name="close" size={13} />
                    Reject
                  </Button>
                  <Button
                    onClick={() => handleApprove(selected.id)}
                    className="gap-2"
                  >
                    <Icon name="check" size={13} />
                    Approve
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <div className="glot-card p-12 text-center">
              <p style={{ color: "var(--muted)" }}>Select a draft to refine.</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function FieldGroup({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1.5">
        <label
          className="mono"
          style={{
            fontSize: 10,
            color: "var(--muted)",
            letterSpacing: "0.12em",
          }}
        >
          {label.toUpperCase()}
        </label>
        {hint && (
          <span style={{ fontSize: 11, color: "var(--muted-2)" }}>{hint}</span>
        )}
      </div>
      {children}
    </div>
  );
}
