// Design tokens of the house style "il registro della trattoria" (docs/design/ui-foundation.md).
// src/app/globals.css is the runtime source (Tailwind v4 `@theme` + the dark-mode override); this
// module mirrors it so the contrast pairs can be tested, and tests/lib/design/tokens.test.ts fails
// if the two drift apart. Client branding, when approved, is applied here and in globals.css only.

export const COLOR_TOKENS = [
  "paper",
  "surface",
  "sunk",
  "ink",
  "ink-muted",
  "rule",
  "rule-strong",
  "accent",
  "accent-hover",
  "on-accent",
  "accent-ink",
  "olive",
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

export const THEMES: Record<Theme, Record<ColorToken, string>> = {
  light: {
    paper: "#F6F1E7",
    surface: "#FBF8F2",
    sunk: "#ECE4D5",
    ink: "#1D1A16",
    "ink-muted": "#5C5348",
    rule: "#E2D8C7",
    "rule-strong": "#8C806E",
    accent: "#B4472B",
    "accent-hover": "#963820",
    "on-accent": "#FFFFFF",
    "accent-ink": "#A8401F",
    olive: "#56663A",
    focus: "#B4472B",
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
    paper: "#17140F",
    surface: "#211C16",
    sunk: "#2B251E",
    ink: "#F2EADB",
    "ink-muted": "#BDB2A0",
    rule: "#3A3229",
    "rule-strong": "#857865",
    accent: "#DB6C4D",
    "accent-hover": "#E8836A",
    "on-accent": "#1A0E09",
    "accent-ink": "#EF9274",
    olive: "#B2C287",
    focus: "#EF9274",
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
  { fg: "ink", bg: "surface", min: AA_TEXT, use: "text in cards and inputs" },
  { fg: "ink", bg: "sunk", min: AA_TEXT, use: "text on hovered rows and tabs" },
  { fg: "paper", bg: "ink", min: AA_TEXT, use: "current tab in the owner nav" },
  { fg: "ink-muted", bg: "paper", min: AA_TEXT, use: "hints and secondary row text" },
  { fg: "ink-muted", bg: "surface", min: AA_TEXT, use: "hints inside cards" },
  { fg: "ink-muted", bg: "sunk", min: AA_TEXT, use: "neutral status badge" },
  { fg: "on-accent", bg: "accent", min: AA_TEXT, use: "primary button label" },
  { fg: "on-accent", bg: "accent-hover", min: AA_TEXT, use: "primary button label, hover" },
  { fg: "accent-ink", bg: "paper", min: AA_TEXT, use: "links and quiet buttons" },
  { fg: "accent-ink", bg: "surface", min: AA_TEXT, use: "links inside cards" },
  { fg: "accent-ink", bg: "sunk", min: AA_TEXT, use: "quiet button, hover" },
  { fg: "olive", bg: "paper", min: AA_TEXT, use: "secondary button label" },
  { fg: "olive", bg: "surface", min: AA_TEXT, use: "secondary button label in cards" },
  { fg: "olive", bg: "sunk", min: AA_TEXT, use: "secondary button label, hover" },
  { fg: "success", bg: "success-bg", min: AA_TEXT, use: "success notice and badge" },
  { fg: "warning", bg: "warning-bg", min: AA_TEXT, use: "warning badge" },
  { fg: "danger", bg: "danger-bg", min: AA_TEXT, use: "error alert and badge" },
  { fg: "danger", bg: "paper", min: AA_TEXT, use: "per-row import errors on the page" },
  { fg: "info", bg: "info-bg", min: AA_TEXT, use: "info badge" },
  { fg: "rule-strong", bg: "surface", min: AA_NON_TEXT, use: "input border in cards" },
  { fg: "rule-strong", bg: "paper", min: AA_NON_TEXT, use: "input border on the page" },
  { fg: "accent", bg: "paper", min: AA_NON_TEXT, use: "primary button shape on the page" },
  { fg: "olive", bg: "paper", min: AA_NON_TEXT, use: "secondary button border" },
  { fg: "focus", bg: "paper", min: AA_NON_TEXT, use: "focus ring on the page" },
  { fg: "focus", bg: "surface", min: AA_NON_TEXT, use: "focus ring in cards" },
];
