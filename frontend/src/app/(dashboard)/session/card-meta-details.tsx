"use client";

/**
 * Review-only display of a card's optional language-learning metadata.
 *
 * Rendered on the answer face of the review card. Each field is independently
 * optional: a chip/section only appears when its value is present, so a card
 * without metadata renders nothing and the review flow is unchanged.
 */

import { Icon } from "@/components/glot/icon";
import { hasCardMeta, type CardMeta } from "@/lib/cards/meta";

function MetaChip({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <span
      className="pill outline"
      style={{ display: "inline-flex", gap: 6, alignItems: "baseline" }}
    >
      <span
        className="mono"
        style={{ fontSize: 9, letterSpacing: "0.12em", color: "var(--muted-2)", textTransform: "uppercase" }}
      >
        {label}
      </span>
      <span className={mono ? "mono" : undefined} style={{ color: "var(--fg)" }}>
        {value}
      </span>
    </span>
  );
}

export function CardMetaDetails({ meta }: { meta: CardMeta }) {
  if (!hasCardMeta(meta)) return null;

  const hasChips = Boolean(meta.wordType || meta.gender || meta.phonetics);
  const hasExample = Boolean(meta.example || meta.exampleTranslation);

  return (
    <div
      className="w-full max-w-xl mt-6 pt-5"
      style={{ borderTop: "1px solid var(--line)" }}
    >
      {hasChips ? (
        <div className="flex flex-wrap items-center justify-center gap-2">
          {meta.wordType ? <MetaChip label="Type" value={meta.wordType} /> : null}
          {meta.gender ? <MetaChip label="Gender" value={meta.gender} /> : null}
          {meta.phonetics ? <MetaChip label="Say" value={meta.phonetics} mono /> : null}
        </div>
      ) : null}

      {hasExample ? (
        <div
          className={hasChips ? "mt-4" : ""}
          style={{ textAlign: "left" }}
        >
          <div
            className="mono mb-2 flex items-center gap-1.5"
            style={{ fontSize: 10, color: "var(--muted-2)", letterSpacing: "0.14em" }}
          >
            <Icon name="book" size={11} />
            EXAMPLE
          </div>
          {meta.example ? (
            <p
              className="serif"
              style={{ fontSize: 17, lineHeight: 1.5, color: "var(--fg)" }}
            >
              {meta.example}
            </p>
          ) : null}
          {meta.exampleTranslation ? (
            <p
              className="serif"
              style={{ fontSize: 15, lineHeight: 1.5, color: "var(--muted)", marginTop: 4 }}
            >
              {meta.exampleTranslation}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
