import * as React from "react";

export type IconName =
  | "home"
  | "layers"
  | "library"
  | "flask"
  | "play"
  | "plus"
  | "arrow"
  | "arrowL"
  | "arrowU"
  | "arrowD"
  | "book"
  | "sparkle"
  | "sound"
  | "edit"
  | "flag"
  | "more"
  | "close"
  | "check"
  | "search"
  | "flame"
  | "clock"
  | "trend"
  | "bolt"
  | "settings"
  | "user"
  | "chev"
  | "chevD"
  | "chevU"
  | "grid"
  | "list"
  | "waveform"
  | "upload"
  | "pdf"
  | "mic"
  | "swipe"
  | "moon"
  | "sun"
  | "bell"
  | "pen"
  | "logout"
  | "eye"
  | "eyeOff"
  | "globe"
  | "filter"
  | "lock"
  | "mail";

interface IconProps {
  name: IconName;
  size?: number;
  className?: string;
  style?: React.CSSProperties;
  strokeWidth?: number;
}

const PATHS: Record<IconName, React.ReactNode> = {
  home: (
    <>
      <path d="M3 11l9-8 9 8" />
      <path d="M5 10v10h14V10" />
    </>
  ),
  layers: (
    <>
      <path d="M12 3l9 5-9 5-9-5 9-5z" />
      <path d="M3 13l9 5 9-5" />
      <path d="M3 17l9 5 9-5" />
    </>
  ),
  library: (
    <>
      <rect x="4" y="3" width="4" height="18" rx="1" />
      <rect x="10" y="3" width="4" height="18" rx="1" />
      <path d="M17 4l3 1-3 17-3-1z" />
    </>
  ),
  flask: (
    <>
      <path d="M9 3h6" />
      <path d="M10 3v6L4 19a2 2 0 002 3h12a2 2 0 002-3l-6-10V3" />
      <path d="M7 14h10" />
    </>
  ),
  play: <path d="M6 4l14 8-14 8z" fill="currentColor" stroke="none" />,
  plus: (
    <>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </>
  ),
  arrow: (
    <>
      <path d="M5 12h14" />
      <path d="M13 6l6 6-6 6" />
    </>
  ),
  arrowL: (
    <>
      <path d="M19 12H5" />
      <path d="M11 18l-6-6 6-6" />
    </>
  ),
  arrowU: (
    <>
      <path d="M12 19V5" />
      <path d="M5 12l7-7 7 7" />
    </>
  ),
  arrowD: (
    <>
      <path d="M12 5v14" />
      <path d="M19 12l-7 7-7-7" />
    </>
  ),
  book: (
    <>
      <path d="M4 4h12a4 4 0 014 4v12H8a4 4 0 01-4-4V4z" />
      <path d="M4 16h16" />
    </>
  ),
  sparkle: (
    <>
      <path d="M12 3l1.5 5.5L19 10l-5.5 1.5L12 17l-1.5-5.5L5 10l5.5-1.5z" />
      <path d="M19 17l.7 2.3L22 20l-2.3.7L19 23l-.7-2.3L16 20l2.3-.7z" />
    </>
  ),
  sound: (
    <>
      <path d="M11 5L6 9H3v6h3l5 4z" />
      <path d="M16 9a4 4 0 010 6" />
      <path d="M19 6a8 8 0 010 12" />
    </>
  ),
  edit: (
    <>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 113 3L7 19l-4 1 1-4z" />
    </>
  ),
  flag: (
    <>
      <path d="M4 22V4" />
      <path d="M4 4h13l-2 4 2 4H4" />
    </>
  ),
  more: (
    <>
      <circle cx="5" cy="12" r="1" />
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
    </>
  ),
  close: (
    <>
      <path d="M18 6L6 18" />
      <path d="M6 6l12 12" />
    </>
  ),
  check: <path d="M5 12l5 5 9-12" />,
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.5-4.5" />
    </>
  ),
  flame: (
    <path d="M12 2c2 4-2 5-2 9a4 4 0 008 0c0-2-1-3-2-5 0 1-1 2-2 2 0-3-1-5-2-6z" />
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  trend: (
    <>
      <path d="M3 17l6-6 4 4 8-8" />
      <path d="M14 7h7v7" />
    </>
  ),
  bolt: <path d="M13 2L4 14h7l-1 8 9-12h-7z" />,
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.6 1.6 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.6 1.6 0 00-1.8-.3 1.6 1.6 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.6 1.6 0 00-1-1.5 1.6 1.6 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.6 1.6 0 00.3-1.8 1.6 1.6 0 00-1.5-1H3a2 2 0 110-4h.1a1.6 1.6 0 001.5-1 1.6 1.6 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.6 1.6 0 001.8.3h0a1.6 1.6 0 001-1.5V3a2 2 0 114 0v.1a1.6 1.6 0 001 1.5 1.6 1.6 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.6 1.6 0 00-.3 1.8v0a1.6 1.6 0 001.5 1H21a2 2 0 110 4h-.1a1.6 1.6 0 00-1.5 1z" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0116 0" />
    </>
  ),
  chev: <path d="M9 6l6 6-6 6" />,
  chevD: <path d="M6 9l6 6 6-6" />,
  chevU: <path d="M18 15l-6-6-6 6" />,
  grid: (
    <>
      <rect x="3" y="3" width="7" height="7" />
      <rect x="14" y="3" width="7" height="7" />
      <rect x="3" y="14" width="7" height="7" />
      <rect x="14" y="14" width="7" height="7" />
    </>
  ),
  list: (
    <>
      <path d="M8 6h13" />
      <path d="M8 12h13" />
      <path d="M8 18h13" />
      <circle cx="3.5" cy="6" r=".7" fill="currentColor" />
      <circle cx="3.5" cy="12" r=".7" fill="currentColor" />
      <circle cx="3.5" cy="18" r=".7" fill="currentColor" />
    </>
  ),
  waveform: (
    <>
      <path d="M3 12h2" />
      <path d="M7 8v8" />
      <path d="M11 5v14" />
      <path d="M15 9v6" />
      <path d="M19 11v2" />
    </>
  ),
  upload: (
    <>
      <path d="M12 16V4" />
      <path d="M6 10l6-6 6 6" />
      <path d="M4 20h16" />
    </>
  ),
  pdf: (
    <>
      <path d="M14 3H6a2 2 0 00-2 2v14a2 2 0 002 2h12a2 2 0 002-2V9z" />
      <path d="M14 3v6h6" />
    </>
  ),
  mic: (
    <>
      <rect x="9" y="3" width="6" height="12" rx="3" />
      <path d="M5 11a7 7 0 0014 0" />
      <path d="M12 18v3" />
    </>
  ),
  swipe: (
    <>
      <path d="M9 12h12" />
      <path d="M16 7l5 5-5 5" />
      <path d="M3 12l3-3" />
      <path d="M3 12l3 3" />
    </>
  ),
  moon: <path d="M21 13a9 9 0 11-10-10 7 7 0 0010 10z" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2" />
      <path d="M12 20v2" />
      <path d="M2 12h2" />
      <path d="M20 12h2" />
      <path d="M4.93 4.93l1.41 1.41" />
      <path d="M17.66 17.66l1.41 1.41" />
      <path d="M4.93 19.07l1.41-1.41" />
      <path d="M17.66 6.34l1.41-1.41" />
    </>
  ),
  bell: (
    <>
      <path d="M6 8a6 6 0 0112 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10 21a2 2 0 004 0" />
    </>
  ),
  pen: (
    <>
      <path d="M14 4l6 6L8 22H2v-6z" />
      <path d="M11 7l6 6" />
    </>
  ),
  logout: (
    <>
      <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
      <path d="M16 17l5-5-5-5" />
      <path d="M21 12H9" />
    </>
  ),
  eye: (
    <>
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  eyeOff: (
    <>
      <path d="M9.88 9.88a3 3 0 104.24 4.24" />
      <path d="M10.73 5.08A10.43 10.43 0 0112 5c7 0 11 7 11 7a13.16 13.16 0 01-1.67 2.68" />
      <path d="M6.61 6.61A13.526 13.526 0 001 12s4 7 11 7a9.74 9.74 0 005.39-1.61" />
      <path d="M2 2l20 20" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M2 12h20" />
      <path d="M12 2a15.3 15.3 0 010 20a15.3 15.3 0 010-20z" />
    </>
  ),
  filter: <path d="M3 4h18l-7 9v7l-4-2v-5z" />,
  lock: (
    <>
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 018 0v4" />
    </>
  ),
  mail: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 7l9 6 9-6" />
    </>
  ),
};

export function Icon({
  name,
  size = 18,
  className,
  style,
  strokeWidth = 1.6,
}: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      aria-hidden
    >
      {PATHS[name]}
    </svg>
  );
}
