import * as React from "react";

interface WordmarkProps {
  size?: number;
  showText?: boolean;
}

export function Wordmark({ size = 22, showText = true }: WordmarkProps) {
  const tile = size + 6;
  return (
    <div className="inline-flex items-center" style={{ gap: 9 }}>
      <div
        style={{
          width: tile,
          height: tile,
          borderRadius: 6,
          background: "var(--accent)",
          color: "var(--accent-fg)",
          display: "grid",
          placeItems: "center",
          fontFamily: "var(--serif)",
          fontWeight: 600,
          fontSize: size - 2,
          letterSpacing: "-0.04em",
          boxShadow: "0 0 24px var(--accent-glow)",
        }}
      >
        g
      </div>
      {showText && (
        <span
          style={{
            fontFamily: "var(--serif)",
            fontSize: size,
            fontWeight: 500,
            letterSpacing: "-0.03em",
          }}
        >
          Glot
          <span style={{ color: "var(--accent)" }}>.</span>
        </span>
      )}
    </div>
  );
}
