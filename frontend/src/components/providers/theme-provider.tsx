"use client";

import * as React from "react";

export type Theme = "dark" | "sepia" | "light";
export type Accent = "lime" | "violet" | "coral" | "sky";
export type Density = "compact" | "regular" | "comfy";

interface TweaksContextValue {
  theme: Theme;
  accent: Accent;
  density: Density;
  setTheme: (t: Theme) => void;
  setAccent: (a: Accent) => void;
  setDensity: (d: Density) => void;
}

const TweaksContext = React.createContext<TweaksContextValue | undefined>(undefined);

const STORAGE_KEY = "glot:tweaks";
const DEFAULT_THEME: Theme = "dark";
const DEFAULT_ACCENT: Accent = "lime";
const DEFAULT_DENSITY: Density = "regular";

function readStored(): Partial<{ theme: Theme; accent: Accent; density: Density }> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function applyToDom(theme: Theme, accent: Accent, density: Density) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.setAttribute("data-theme", theme);
  root.setAttribute("data-accent", accent);
  root.setAttribute("data-density", density);
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = React.useState<Theme>(DEFAULT_THEME);
  const [accent, setAccentState] = React.useState<Accent>(DEFAULT_ACCENT);
  const [density, setDensityState] = React.useState<Density>(DEFAULT_DENSITY);

  // Hydrate once on mount from localStorage
  React.useEffect(() => {
    const stored = readStored();
    const t = stored.theme ?? DEFAULT_THEME;
    const a = stored.accent ?? DEFAULT_ACCENT;
    const d = stored.density ?? DEFAULT_DENSITY;
    setThemeState(t);
    setAccentState(a);
    setDensityState(d);
    applyToDom(t, a, d);
  }, []);

  const persist = React.useCallback((next: { theme: Theme; accent: Accent; density: Density }) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
  }, []);

  const setTheme = React.useCallback(
    (t: Theme) => {
      setThemeState(t);
      applyToDom(t, accent, density);
      persist({ theme: t, accent, density });
    },
    [accent, density, persist]
  );

  const setAccent = React.useCallback(
    (a: Accent) => {
      setAccentState(a);
      applyToDom(theme, a, density);
      persist({ theme, accent: a, density });
    },
    [theme, density, persist]
  );

  const setDensity = React.useCallback(
    (d: Density) => {
      setDensityState(d);
      applyToDom(theme, accent, d);
      persist({ theme, accent, density: d });
    },
    [theme, accent, persist]
  );

  const value = React.useMemo<TweaksContextValue>(
    () => ({ theme, accent, density, setTheme, setAccent, setDensity }),
    [theme, accent, density, setTheme, setAccent, setDensity]
  );

  return <TweaksContext.Provider value={value}>{children}</TweaksContext.Provider>;
}

export function useTweaks(): TweaksContextValue {
  const ctx = React.useContext(TweaksContext);
  if (!ctx) {
    throw new Error("useTweaks must be used within ThemeProvider");
  }
  return ctx;
}
