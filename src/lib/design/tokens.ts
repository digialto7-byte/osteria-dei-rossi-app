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

/**
 * The five colours of the Costì product brand approved by the founder (docs/client-facts.md, "Product (DigiAlto)"). Coral is an
 * accent only (never text); every other shade is derived (PRODUCT_DERIVED) or the white card surface.
 */
export const PRODUCT_BRAND = {
  forest: "#0E4D3A",
  coral: "#FF7A5C",
  sage: "#DCEDE6",
  offWhite: "#F7F8F6",
  charcoal: "#1F2933",
} as const;

/**
 * Product shades derived from PRODUCT_BRAND (docs/plans/2026-11-13-costi-product-brand.md §3.3); a test checks each literal
 * against its formula.
 *   white           = the card surface in light
 *   inkMuted        = mix(charcoal, offWhite, 0.25)   hints in light
 *   rule            = mix(sage, forest, 0.2)          hairlines in light
 *   ruleStrong      = mix(charcoal, offWhite, 0.4)    input borders in light
 *   accentHover     = mix(forest, charcoal, 0.4)      primary button, hover, light
 *   darkSurface     = mix(charcoal, offWhite, 0.06)
 *   darkSunk        = mix(charcoal, offWhite, 0.12)
 *   darkInkMuted    = mix(offWhite, charcoal, 0.32)
 *   darkRule        = mix(charcoal, offWhite, 0.2)
 *   darkRuleStrong  = mix(charcoal, offWhite, 0.45)
 *   darkAccentHover = mix(sage, offWhite, 0.6)
 */
export const PRODUCT_DERIVED = {
  white: "#FFFFFF",
  inkMuted: "#555D64",
  rule: "#B3CDC4",
  ruleStrong: "#757C81",
  accentHover: "#153F37",
  darkSurface: "#2C353F",
  darkSunk: "#39424A",
  darkInkMuted: "#B2B6B8",
  darkRule: "#4A525A",
  darkRuleStrong: "#80868B",
  darkAccentHover: "#ECF4F0",
} as const;

/**
 * The Costì product theme: the same token names as THEMES with product values, applied under `data-brand="costi"` (globals.css,
 * `:root:has([data-brand="costi"])`). Coral takes gold and highlight, which are accent-only. The status tones are semantic, not
 * brand, so they keep the osteria values.
 */
export const PRODUCT_THEMES: Record<Theme, Record<ColorToken, string>> = {
  light: {
    paper: PRODUCT_BRAND.offWhite,
    surface: PRODUCT_DERIVED.white,
    sunk: PRODUCT_BRAND.sage,
    ink: PRODUCT_BRAND.charcoal,
    "ink-muted": PRODUCT_DERIVED.inkMuted,
    rule: PRODUCT_DERIVED.rule,
    "rule-strong": PRODUCT_DERIVED.ruleStrong,
    band: PRODUCT_BRAND.forest,
    "band-ink": PRODUCT_BRAND.offWhite,
    gold: PRODUCT_BRAND.coral,
    highlight: PRODUCT_BRAND.coral,
    "on-highlight": PRODUCT_BRAND.charcoal,
    accent: PRODUCT_BRAND.forest,
    "accent-hover": PRODUCT_DERIVED.accentHover,
    "on-accent": PRODUCT_BRAND.offWhite,
    "accent-ink": PRODUCT_BRAND.forest,
    focus: PRODUCT_BRAND.forest,
    success: THEMES.light.success,
    "success-bg": THEMES.light["success-bg"],
    warning: THEMES.light.warning,
    "warning-bg": THEMES.light["warning-bg"],
    danger: THEMES.light.danger,
    "danger-bg": THEMES.light["danger-bg"],
    info: THEMES.light.info,
    "info-bg": THEMES.light["info-bg"],
  },
  dark: {
    paper: PRODUCT_BRAND.charcoal,
    surface: PRODUCT_DERIVED.darkSurface,
    sunk: PRODUCT_DERIVED.darkSunk,
    ink: PRODUCT_BRAND.offWhite,
    "ink-muted": PRODUCT_DERIVED.darkInkMuted,
    rule: PRODUCT_DERIVED.darkRule,
    "rule-strong": PRODUCT_DERIVED.darkRuleStrong,
    band: PRODUCT_BRAND.forest,
    "band-ink": PRODUCT_BRAND.offWhite,
    gold: PRODUCT_BRAND.coral,
    highlight: PRODUCT_BRAND.coral,
    "on-highlight": PRODUCT_BRAND.charcoal,
    accent: PRODUCT_BRAND.sage,
    "accent-hover": PRODUCT_DERIVED.darkAccentHover,
    "on-accent": PRODUCT_BRAND.charcoal,
    "accent-ink": PRODUCT_BRAND.sage,
    focus: PRODUCT_BRAND.sage,
    success: THEMES.dark.success,
    "success-bg": THEMES.dark["success-bg"],
    warning: THEMES.dark.warning,
    "warning-bg": THEMES.dark["warning-bg"],
    danger: THEMES.dark.danger,
    "danger-bg": THEMES.dark["danger-bg"],
    info: THEMES.dark.info,
    "info-bg": THEMES.dark["info-bg"],
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
  { fg: "band-ink", bg: "band", min: AA_NON_TEXT, use: "focus ring on the header band" },
  // Owner dashboard charts (ADR-021): shapes, not text, so 3:1. accent on surface is above.
  { fg: "danger", bg: "surface", min: AA_NON_TEXT, use: "below-target bar on a tile" },
  { fg: "ink", bg: "sunk", min: AA_NON_TEXT, use: "target tick over the bar track" },
];

/** Tokens that are accents only: never a text colour (they fail AA on cream). */
export const ACCENT_ONLY: readonly ColorToken[] = ["gold", "highlight"];

/** WCAG AAA for body text: 7:1. The kitchen's high-contrast mode uses only pairs that reach it (M19 plan §3.1.11). */
export const AAA_TEXT = 7;

/**
 * The foreground/background pairs of the kitchen screen in high-contrast mode, checked in both themes: no muted text, no
 * accent colour as text; names, quantities, notes and the "Stornato" words are `ink` on the page, card or hover colour, and
 * the pressed toggle is `paper` on `ink`. Borders are 2 px `ink` (see `[data-contrast="high"]` in globals.css).
 */
export const HIGH_CONTRAST_PAIRS: readonly ContrastPair[] = [
  { fg: "ink", bg: "paper", min: AAA_TEXT, use: "the page behind the ticket list" },
  {
    fg: "ink",
    bg: "surface",
    min: AAA_TEXT,
    use: "names, quantities, notes and badges on a ticket",
  },
  { fg: "ink", bg: "sunk", min: AAA_TEXT, use: "badges and the line of a voided dish" },
  { fg: "paper", bg: "ink", min: AAA_TEXT, use: "the high-contrast toggle when pressed" },
];
