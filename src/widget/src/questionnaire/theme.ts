import type React from "react";

/**
 * Edit these values to reconfigure the widget's custom accent/semantic colors.
 * `light` applies when the host theme is light; `dark` applies when the host theme is dark.
 *
 * Keys:
 *   accent      — Primary brand/accent color (shell top border, card hover/focus ring).
 *   secondary   — Secondary accent color (available for future highlights or overrides).
 *   cardBg      — Background fill for answered-answer cards in the history nav.
 *   cardBorder  — Border color for answered-answer cards.
 *   status      — Emphasis color used for the answer text inside answered-answer cards.
 */

export interface WidgetPalette {
  accent: string;
  secondary: string;
  cardBg: string;
  cardBorder: string;
  status: string;
}

const lightPalette: WidgetPalette = {
  accent: "#2563EB",     // Blue-600 — brand accent, shell border-top
  secondary: "#7C3AED",  // Violet-700 — complementary secondary accent
  cardBg: "#EFF6FF",     // Blue-50 — subtle answered-card background
  cardBorder: "#BFDBFE", // Blue-200 — answered-card border
  status: "#1D4ED8",     // Blue-700 — answer text emphasis (≥7:1 contrast on cardBg)
};

const darkPalette: WidgetPalette = {
  accent: "#60A5FA",     // Blue-400 — bright accent on dark Fluent surfaces
  secondary: "#A78BFA",  // Violet-400 — bright complementary on dark
  cardBg: "#1E293B",     // Slate-800 — dark card surface
  cardBorder: "#475569", // Slate-600 — visible border on dark surface
  status: "#93C5FD",     // Blue-300 — answer text emphasis (≥8:1 contrast on cardBg)
};

/** Returns the palette variant for the given host theme. */
export function getPalette(theme: "light" | "dark"): WidgetPalette {
  return theme === "dark" ? darkPalette : lightPalette;
}

/**
 * Maps a palette variant to React inline-style CSS custom properties.
 * Apply via `<element style={paletteToCssVars(getPalette(theme))} />`.
 */
export function paletteToCssVars(p: WidgetPalette): React.CSSProperties {
  return {
    ["--gea-accent"]: p.accent,
    ["--gea-secondary"]: p.secondary,
    ["--gea-card-bg"]: p.cardBg,
    ["--gea-card-border"]: p.cardBorder,
    ["--gea-status"]: p.status,
  } as React.CSSProperties;
}
