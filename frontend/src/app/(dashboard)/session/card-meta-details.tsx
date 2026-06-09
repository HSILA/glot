"use client";

/**
 * Review-only display of a card's optional language-learning metadata, matching
 * the Glot design language (mono phonetics, a "type · gender" grammatical row
 * with a colored gender dot, and an italic example sentence with the target
 * word emphasized in the accent color).
 *
 * Every part is independently optional: each element omits itself gracefully
 * when its value is absent, so a card without metadata renders nothing and the
 * review flow is unchanged.
 */

import type { CSSProperties } from "react";

import {
  classifyGender,
  hasGrammarMeta,
  splitHighlight,
  type CardMeta,
  type GenderTone,
} from "@/lib/cards/meta";

/**
 * Clamp text to `lines` lines with an ellipsis on overflow. Keeps long metadata
 * from pushing the card taller, with no scrollbars (`overflow: hidden`).
 */
function lineClamp(lines: number): CSSProperties {
  return {
    overflow: "hidden",
    textOverflow: "ellipsis",
    display: "-webkit-box",
    WebkitLineClamp: lines,
    WebkitBoxOrient: "vertical",
    maxWidth: "100%",
  };
}

const GENDER_DOT: Record<GenderTone, string> = {
  masculine: "var(--info)",
  feminine: "#c5a3ff",
  neuter: "var(--muted)",
  other: "var(--muted-2)",
};

const GENDER_LABEL: Record<Exclude<GenderTone, "other">, string> = {
  masculine: "masc.",
  feminine: "fem.",
  neuter: "neut.",
};

function GenderPill({ gender }: { gender: string }) {
  const tone = classifyGender(gender);
  const label = tone === "other" ? gender : GENDER_LABEL[tone];
  return (
    <span
      className="pill outline"
      style={{ fontSize: 9, padding: "1px 7px", gap: 5, display: "inline-flex", alignItems: "center" }}
    >
      <span style={{ width: 5, height: 5, borderRadius: "50%", background: GENDER_DOT[tone] }} />
      {label}
    </span>
  );
}

/** Pronunciation in mono. Renders nothing when absent. Clamped to 1 line. */
export function CardPhonetic({ meta, size = 14 }: { meta: CardMeta; size?: number }) {
  if (!meta.phonetics) return null;
  return (
    <span className="mono" style={{ fontSize: size, color: "var(--muted)", ...lineClamp(1) }}>
      {meta.phonetics}
    </span>
  );
}

/** Grammatical row: phonetics, then "type · gender". Renders only what exists. */
export function CardGrammar({ meta }: { meta: CardMeta }) {
  if (!hasGrammarMeta(meta)) return null;

  const hasWordMeta = Boolean(meta.wordType || meta.gender);

  return (
    <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-2" style={{ marginTop: 10 }}>
      <CardPhonetic meta={meta} size={14} />
      {hasWordMeta ? (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          {meta.wordType ? (
            <span style={{ fontSize: 13, color: "var(--muted)" }}>{meta.wordType}</span>
          ) : null}
          {meta.wordType && meta.gender ? (
            <span style={{ color: "var(--muted-2)" }}>·</span>
          ) : null}
          {meta.gender ? <GenderPill gender={meta.gender} /> : null}
        </span>
      ) : null}
    </div>
  );
}

/** Example sentence (italic) with translation, set off by a hairline rule. */
export function CardExample({ meta }: { meta: CardMeta }) {
  if (!meta.example && !meta.exampleTranslation) return null;

  return (
    <div
      className="w-full max-w-xl mt-7 pt-5"
      style={{ borderTop: "1px solid var(--line)", textAlign: "center" }}
    >
      {meta.example ? (
        <p
          className="serif"
          style={{ fontStyle: "italic", fontSize: 17, lineHeight: 1.6, color: "var(--fg-1)", ...lineClamp(2) }}
        >
          {splitHighlight(meta.example, meta.exampleHighlight).map((seg, i) =>
            seg.highlight ? (
              <span key={i} style={{ color: "var(--accent)", fontStyle: "normal" }}>
                {seg.text}
              </span>
            ) : (
              <span key={i}>{seg.text}</span>
            ),
          )}
        </p>
      ) : null}
      {meta.exampleTranslation ? (
        <p style={{ fontSize: 14, color: "var(--muted)", marginTop: 6, ...lineClamp(2) }}>
          {meta.exampleTranslation}
        </p>
      ) : null}
    </div>
  );
}
