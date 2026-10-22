// Design tokens of the Osteria Dei Rossi house style (docs/design/ui-foundation.md).
// src/app/globals.css is the runtime source (Tailwind v4 `@theme` + the dark-theme override); this
// module mirrors it so the contrast pairs can be tested, and tests/lib/design/tokens.test.ts fails
// if the two drift apart.

import { parseHex } from "./contrast";

export const COLOR_TOKENS = [
  "paper",
  "surface",
  "sunk",
  "ink",
  "ink-muted",
  "rule",
  "rule-strong",
  "band",
  "band-ink",
  "gold",
  "highlight",
  "on-highlight",
  "accent",
  "accent-hover",
  "on-accent",
  "accent-ink",
  "focus",
  "success",
  "success-bg",
  "warning",
  "warning-bg",
  "danger",
  "danger-bg",
  "info",
  "info-bg",
] as const;

export type ColorToken = (typeof COLOR_TOKENS)[number];
export type Theme = "light" | "dark";

/**
 * The eight colours of the Osteria Dei Rossi brand approved by the founder (docs/client-facts.md).
 * Nothing else belongs here: every other shade is derived (see DERIVED). Gold and yellow are
 * accents: rules, badges, the logo slot, never text on cream.
 */
export const BRAND = {
  cream: "#FFFADF",
  creamDeep: "#F8EFC6",
  green: "#1C4130",
  gold: "#C89550",
  olive: "#7D9550",
  soft: "#4D5B45",
  black: "#0F0F0D",
  yellow: "#FFB028",
} as const;

/** Linear blend of two #RRGGBB colours: `a` at t = 0, `b` at t = 1. Uppercase, channels rounded. */
export function mix(a: string, b: string, t: number): string {
  if (!(t >= 0 && t <= 1)) throw new RangeError(`mix: t must be within 0..1, got ${t}`);
  const [from, to] = [parseHex(a), parseHex(b)];
  const out = from.map((x, i) => Math.round(x + (to[i]! - x) * t));
  return `#${out
    .map((c) => c.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase()}`;
}

/**
 * UI shades derived from approved colours. THEMES and globals.css hold the literal hex values
 * (they must stay in sync, and a test checks each literal against its formula).
 *   rule          = mix(creamDeep, gold, 0.3)   hairlines in light
 *   darkInk       = cream                       body text and band text in dark
 *   darkInkMuted  = mix(cream, black, 0.3)      hints in dark (AA on every dark background)
 */
export const DERIVED = {
  rule: "#EAD4A3",
  darkInk: "#FFFADF",
  darkInkMuted: "#B7B4A0",
} as const;

export const THEMES: Record<Theme, Record<ColorToken, string>> = {
  light: {
    paper: "#FFFADF",
    surface: "#FFFDF2",
    sunk: "#F8EFC6",
    ink: "#0F0F0D",
    "ink-muted": "#4D5B45",
    rule: "#EAD4A3",
    "rule-strong": "#857A57",
    band: "#1C4130",
    "band-ink": "#FFFADF",
    gold: "#C89550",
    highlight: "#FFB028",
    "on-highlight": "#0F0F0D",
    accent: "#1C4130",
    "accent-hover": "#122C20",
    "on-accent": "#FFFADF",
    "accent-ink": "#1C4130",
    focus: "#8A5F22",
    success: "#2D6435",
    "success-bg": "#E2ECD9",
    warning: "#74480A",
    "warning-bg": "#F5E5C3",
    danger: "#9A2A1D",
    "danger-bg": "#F6DDD5",
    info: "#1E5470",
    "info-bg": "#DCE8EE",
  },
  dark: {
    paper: "#0F0F0D",
    surface: "#1A1A16",
    sunk: "#25241F",
    ink: "#FFFADF",
    "ink-muted": "#B7B4A0",
    rule: "#33322B",
    "rule-strong": "#7A7462",
    band: "#16301F",
    "band-ink": "#FFFADF",
    gold: "#C89550",
    highlight: "#FFB028",
    "on-highlight": "#0F0F0D",
    accent: "#8CB89A",
    "accent-hover": "#A6CBB1",
    "on-accent": "#0F0F0D",
    "accent-ink": "#A9D1B4",
    focus: "#C89550",
    success: "#A3D4A9",
    "success-bg": "#1B2C1D",
    warning: "#EBC57E",
    "warning-bg": "#302511",
    danger: "#F4A694",
    "danger-bg": "#391A12",
    info: "#A1CBE2",
    "info-bg": "#14252F",
  },
};

/** WCAG AA minimums: 4.5:1 for body text, 3:1 for UI boundaries and focus indicators (1.4.11). */
export const AA_TEXT = 4.5;
export const AA_NON_TEXT = 3;

export interface ContrastPair {
  fg: ColorToken;
  bg: ColorToken;
  min: number;
  use: string;
}

/** Every foreground/background combination the components use; checked in both themes. */
export const CONTRAST_PAIRS: readonly ContrastPair[] = [
  { fg: "ink", bg: "paper", min: AA_TEXT, use: "body text on the page" },
  { fg: "ink", bg: "surface", min: AA_TEXT, use: "text in cards, inputs, secondary buttons" },
  { fg: "ink", bg: "sunk", min: AA_TEXT, use: "text on hovered rows, tabs and buttons" },
  { fg: "paper", bg: "ink", min: AA_TEXT, use: "current tab in the owner nav" },
  { fg: "ink-muted", bg: "paper", min: AA_TEXT, use: "hints and secondary row text" },
  { fg: "ink-muted", bg: "surface", min: AA_TEXT, use: "hints inside cards" },
  { fg: "ink-muted", bg: "sunk", min: AA_TEXT, use: "neutral status badge" },
  { fg: "band-ink", bg: "band", min: AA_TEXT, use: "wordmark on the header band" },
  { fg: "on-accent", bg: "accent", min: AA_TEXT, use: "primary button label" },
  { fg: "on-accent", bg: "accent-hover", min: AA_TEXT, use: "primary button label, hover" },
  { fg: "accent-ink", bg: "paper", min: AA_TEXT, use: "links and quiet buttons" },
  { fg: "accent-ink", bg: "surface", min: AA_TEXT, use: "links inside cards" },
  { fg: "accent-ink", bg: "sunk", min: AA_TEXT, use: "quiet button, hover" },
  { fg: "on-highlight", bg: "highlight", min: AA_TEXT, use: '"Consigliato" badge' },
  { fg: "success", bg: "success-bg", min: AA_TEXT, use: "success notice and badge" },
  { fg: "warning", bg: "warning-bg", min: AA_TEXT, use: "warning badge and extraction notes" },
  { fg: "danger", bg: "danger-bg", min: AA_TEXT, use: "error alert and badge" },
  { fg: "danger", bg: "paper", min: AA_TEXT, use: "per-row import errors on the page" },
  { fg: "info", bg: "info-bg", min: AA_TEXT, use: "info badge" },
  { fg: "rule-strong", bg: "surface", min: AA_NON_TEXT, use: "input border in cards" },
  { fg: "rule-strong", bg: "paper", min: AA_NON_TEXT, use: "input border on the page" },
  { fg: "accent", bg: "paper", min: AA_NON_TEXT, use: "primary button shape on the page" },
  { fg: "accent", bg: "surface", min: AA_NON_TEXT, use: "primary button shape in cards" },
  { fg: "ink", bg: "surface", min: AA_NON_TEXT, use: "secondary button border" },
  { fg: "focus", bg: "paper", min: AA_NON_TEXT, use: "focus ring on the page" },
  { fg: "focus", bg: "surface", min: AA_NON_TEXT, use: "focus ring in cards" },
  { fg: "gold", bg: "band", min: AA_NON_TEXT, use: "gold rule under the wordmark" },
];

/** Tokens that are accents only: never a text colour (they fail AA on cream). */
export const ACCENT_ONLY: readonly ColorToken[] = ["gold", "highlight"];
