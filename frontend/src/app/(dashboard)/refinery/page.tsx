"use client";

import { Icon } from "@/components/glot/icon";
import { Button } from "@/components/ui/button";

export default function RefineryPage() {
  return (
    <div className="max-w-5xl mx-auto pb-8">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <main className="min-h-[calc(100vh-220px)] flex flex-col">
          <div className="mb-7">
            <div className="flex items-center gap-2 mb-2">
              <Icon name="sparkle" size={18} style={{ color: "var(--accent)" }} />
              <span
                className="mono"
                style={{
                  fontSize: 11,
                  color: "var(--accent)",
                  letterSpacing: "0.14em",
                }}
              >
                REFINERY
              </span>
              <span className="pill" style={{ fontSize: 10, padding: "2px 7px" }}>
                SOON
              </span>
            </div>
            <h1
              className="serif"
              style={{
                fontSize: "clamp(34px, 5vw, 52px)",
                fontWeight: 500,
                letterSpacing: "-0.03em",
                lineHeight: 1.05,
                marginBottom: 10,
              }}
            >
              Turn anything into <span style={{ fontStyle: "italic", color: "var(--muted)" }}>flashcards.</span>
            </h1>
            <p style={{ color: "var(--muted)", fontSize: 16, lineHeight: 1.55, maxWidth: 760 }}>
              Drop a PDF, paste a URL, or dump messy notes. The chat interface is being built and will be available here soon.
            </p>
          </div>

          <div className="flex-1 flex flex-col justify-end gap-5">
            <div className="flex gap-3">
              <div
                className="grid place-items-center flex-shrink-0"
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 10,
                  background: "var(--surface)",
                  border: "1px solid var(--line)",
                }}
              >
                <Icon name="sparkle" size={15} style={{ color: "var(--accent)" }} />
              </div>
              <div style={{ flex: 1 }}>
                <div
                  className="mono"
                  style={{
                    fontSize: 10,
                    color: "var(--muted)",
                    letterSpacing: "0.1em",
                    marginBottom: 8,
                  }}
                >
                  REFINERY · UNDER DEVELOPMENT
                </div>
                <div
                  className="glot-card p-5"
                  style={{
                    background:
                      "linear-gradient(135deg, color-mix(in oklab, var(--accent) 7%, var(--surface)), var(--surface))",
                  }}
                >
                  <div className="serif mb-2" style={{ fontSize: 22, fontWeight: 500 }}>
                    This feature is under development.
                  </div>
                  <p style={{ color: "var(--muted)", lineHeight: 1.6, margin: 0 }}>
                    No generated cards or mock-up data are shown yet. When Refinery is ready, this space will become the assistant chat for creating cards from sources.
                  </p>
                </div>
              </div>
            </div>

            <div style={{ paddingTop: 20 }}>
              <div
                style={{
                  border: "1px solid var(--line-2)",
                  borderRadius: 16,
                  background: "var(--surface)",
                  padding: 4,
                  opacity: 0.68,
                }}
              >
                <textarea
                  disabled
                  placeholder="Paste a URL, drop a PDF, or describe what you want…"
                  style={{
                    width: "100%",
                    minHeight: 62,
                    padding: "14px 16px",
                    background: "transparent",
                    fontSize: 14,
                    color: "var(--fg)",
                    resize: "none",
                    lineHeight: 1.5,
                    cursor: "not-allowed",
                  }}
                />
                <div className="flex items-center gap-2 px-3 py-2">
                  <Button disabled variant="ghost" size="sm" className="gap-2">
                    <Icon name="upload" size={13} />
                    Attach
                  </Button>
                  <Button disabled variant="ghost" size="sm" className="gap-2">
                    <Icon name="pdf" size={13} />
                    PDF
                  </Button>
                  <Button disabled variant="ghost" size="sm" aria-label="Voice input">
                    <Icon name="mic" size={13} />
                  </Button>
                  <span className="mono hidden sm:inline" style={{ fontSize: 10, color: "var(--muted-2)", marginLeft: 6 }}>
                    FEATURE LOCKED
                  </span>
                  <div className="flex-1" />
                  <span className="mono hidden sm:inline" style={{ fontSize: 10, color: "var(--muted)" }}>
                    coming soon
                  </span>
                  <Button disabled size="sm" aria-label="Send">
                    <Icon name="arrowU" size={13} />
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </main>

        <aside
          className="hidden lg:block"
          style={{
            borderLeft: "1px solid var(--line)",
            paddingLeft: 24,
          }}
        >
          <div className="mono" style={{ fontSize: 10, color: "var(--muted)", letterSpacing: "0.14em", marginBottom: 12 }}>
            STATUS
          </div>
          <div className="glot-card p-4 mb-5">
            <div className="flex items-center gap-2 mb-2">
              <Icon name="lock" size={14} style={{ color: "var(--accent)" }} />
              <span style={{ fontSize: 13, fontWeight: 600 }}>Refinery is not available yet</span>
            </div>
            <p style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.5, margin: 0 }}>
              Sources, recent runs, and generated drafts will appear here after the feature is connected.
            </p>
          </div>

          <div className="mono" style={{ fontSize: 10, color: "var(--muted)", letterSpacing: "0.14em", marginBottom: 12 }}>
            INPUTS
          </div>
          <div className="grid gap-2">
            {[
              ["upload", "Files"],
              ["pdf", "PDFs"],
              ["library", "URLs"],
              ["edit", "Notes"],
            ].map(([icon, label]) => (
              <div
                key={label}
                className="flex items-center gap-2"
                style={{
                  padding: "10px 12px",
                  borderRadius: 8,
                  background: "var(--surface)",
                  border: "1px solid var(--line)",
                  color: "var(--muted)",
                  fontSize: 13,
                }}
              >
                <Icon name={icon as "upload" | "pdf" | "library" | "edit"} size={13} />
                {label}
                <span className="mono ml-auto" style={{ fontSize: 9, color: "var(--muted-2)" }}>
                  soon
                </span>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}
