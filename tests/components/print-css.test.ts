import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { contrastRatio } from "@/lib/design/contrast";
import { COLOR_TOKENS, CONTRAST_PAIRS, PRINT_COLORS, type ColorToken } from "@/lib/design/tokens";
import { PRINT_DROPPED, PRINT_FILLS } from "./print-fills-selectors";

// M24 step 9 (plan §3.1.9, AT3, ADR-027): one global print block sets A4, hides every navigation and status slot, and the dark palette is limited
// to the screen. Alignment pass (costi-design-system §10.5): paper is black on white, fills print white with a 1 px outline. The real PDF is checked in e2e/exports.spec.ts (T1).
const css = readFileSync("src/app/globals.css", "utf8");
const code = css.replace(/\/\*[\s\S]*?\*\//g, "");

/** The text between the braces of the block that starts at `open` (the index of its "{"). */
function bodyFrom(text: string, open: number): string {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === "{") depth += 1;
    if (text[i] === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(open + 1, i);
    }
  }
  throw new Error("unbalanced braces");
}

function blocksOf(text: string, header: RegExp): string[] {
  return [...text.matchAll(new RegExp(header.source, "g"))].map((m) =>
    bodyFrom(text, m.index + m[0].length - 1),
  );
}

const PRINT_HIDDEN = [
  "nav",
  '[data-slot="sync-status"]',
  '[data-slot="nav-placeholder"]',
  '[data-slot="sidebar-placeholder"]',
  '[data-print="hide"]',
];

describe("the print block", () => {
  const blocks = blocksOf(code, /@media\s+print\s*\{/);

  it("exists exactly once", () => {
    expect(blocks).toHaveLength(1);
  });

  it("sets the page to A4 with a 12 mm margin", () => {
    const page = blocksOf(blocks[0]!, /@page\s*\{/);
    expect(page).toHaveLength(1);
    expect(page[0]).toMatch(/size:\s*A4\s*;/);
    expect(page[0]).toMatch(/margin:\s*12mm\s*;/);
  });

  it("hides the navigation, the status slots and the screen-only controls with display: none !important", () => {
    const rest = blocks[0]!.replace(/@page\s*\{[^}]*\}/, "");
    const rule = /([^{}]+)\{([^}]*)\}/g;
    const hidden = new Set<string>();
    for (const [, selectors = "", body = ""] of rest.matchAll(rule)) {
      if (/display:\s*none\s*!important/.test(body)) {
        for (const s of selectors.split(",")) hidden.add(s.trim());
      }
    }
    for (const selector of PRINT_HIDDEN) expect(hidden, selector).toContain(selector);
  });

  it("prints with the light colour scheme", () => {
    expect(blocks[0]).toMatch(/color-scheme:\s*light\s*;/);
  });

  // The rules of the block, with their selector list and body, the @page rule left out.
  const rules = [
    ...blocks[0]!.replace(/@page\s*\{[^}]*\}/, "").matchAll(/([^{}]+)\{([^}]*)\}/g),
  ].map(([, selectors = "", body = ""]) => ({
    selectors: selectors.split(",").map((x) => x.trim()),
    body,
  }));
  const ruleFor = (selector: string) =>
    rules.filter((r) => r.selectors.includes(selector)).map((r) => r.body);

  it("declares the print palette on both light roots, equal to PRINT_COLORS for all 25 tokens", () => {
    const palette = rules.filter(
      (r) =>
        r.selectors.length === 2 &&
        r.selectors[0] === ":root" &&
        r.selectors[1] === ':root:has([data-brand="costi"])',
    );
    expect(palette).toHaveLength(1);
    const declared = Object.fromEntries(
      [...palette[0]!.body.matchAll(/--color-([\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)].map((m) => [
        m[1],
        m[2]!.toLowerCase(),
      ]),
    );
    expect(COLOR_TOKENS).toHaveLength(25);
    expect(Object.keys(declared).sort()).toEqual([...COLOR_TOKENS].sort());
    for (const token of COLOR_TOKENS) {
      expect(declared[token], token).toBe(PRINT_COLORS[token].toLowerCase());
    }
  });

  it("no rule of the block other than the palette carries a hex colour or a colour token", () => {
    const others = rules.filter((r) => !r.selectors.includes(':root:has([data-brand="costi"])'));
    expect(others.length).toBeGreaterThan(0);
    for (const rule of others) {
      expect(rule.body, rule.selectors.join(", ")).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(rule.body, rule.selectors.join(", ")).not.toMatch(/--color-[\w-]+:\s*#/);
    }
  });

  it("PRINT_COLORS holds the §10.5 values: black ink, #404040 muted, white surfaces, black rules and tones, white fills", () => {
    const expected: Record<ColorToken, string> = {
      ink: "#000000",
      "ink-muted": "#404040",
      paper: "#ffffff",
      surface: "#ffffff",
      sunk: "#ffffff",
      rule: "#000000",
      "rule-strong": "#000000",
      band: "#ffffff",
      "band-ink": "#000000",
      gold: "#000000",
      success: "#000000",
      warning: "#000000",
      danger: "#000000",
      info: "#000000",
      "accent-ink": "#000000",
      focus: "#000000",
      highlight: "#ffffff",
      accent: "#ffffff",
      "accent-hover": "#ffffff",
      "success-bg": "#ffffff",
      "warning-bg": "#ffffff",
      "danger-bg": "#ffffff",
      "info-bg": "#ffffff",
      "on-highlight": "#000000",
      "on-accent": "#000000",
    };
    const actual = Object.fromEntries(
      COLOR_TOKENS.map((token) => [token, PRINT_COLORS[token].toLowerCase()]),
    );
    expect(actual).toEqual(expected);
  });

  it("the muted ink survives a photocopy (9:1 on white) and every contrast pair holds with the print palette", () => {
    expect(contrastRatio(PRINT_COLORS["ink-muted"], PRINT_COLORS.paper)).toBeGreaterThanOrEqual(9);
    // The only exceptions: the accent fill turned white on a white page. Its shape is carried by the outline (the fill rule below).
    const fillShapes = CONTRAST_PAIRS.filter(
      (p) => p.fg === "accent" && (p.bg === "paper" || p.bg === "surface"),
    );
    expect(fillShapes).toHaveLength(2);
    for (const pair of CONTRAST_PAIRS) {
      if (fillShapes.includes(pair)) continue;
      expect(
        contrastRatio(PRINT_COLORS[pair.fg], PRINT_COLORS[pair.bg]),
        `${pair.fg} on ${pair.bg} (${pair.use})`,
      ).toBeGreaterThanOrEqual(pair.min);
    }
  });

  it("the band prints without a background image and beats the venue layer's inline variables", () => {
    const body = ruleFor(".band").join(";");
    expect(body).toMatch(/background-image:\s*none\s*;/);
    expect(body).toMatch(/--color-band:\s*var\(--color-paper\)\s*!important/);
    expect(body).toMatch(/--color-band-ink:\s*var\(--color-ink\)\s*!important/);
  });

  it("drops every shadow", () => {
    const body = rules
      .filter((r) => r.selectors.includes("*"))
      .map((r) => r.body)
      .join(";");
    expect(body).toMatch(/box-shadow:\s*none\s*!important/);
    expect(body).toMatch(/text-shadow:\s*none\s*!important/);
  });

  it("draws chart bars in ink, since the accent prints white", () => {
    expect(ruleFor("[data-chart-value]").join(";")).toMatch(/fill:\s*var\(--color-ink\)\s*;/);
  });

  it("one rule turns every fill white with black words and a 1 px inset outline, for exactly the PRINT_FILLS selectors", () => {
    const fills = rules.filter((r) => r.selectors.includes(PRINT_FILLS[0]));
    expect(fills).toHaveLength(1);
    expect([...fills[0]!.selectors].sort()).toEqual([...PRINT_FILLS].sort());
    const body = fills[0]!.body;
    expect(body).toMatch(/background-color:\s*var\(--color-paper\)\s*!important/);
    expect(body).toMatch(/color:\s*var\(--color-ink\)\s*!important/);
    expect(body).toMatch(/outline:\s*1px solid var\(--color-ink\)\s*;/);
    expect(body).toMatch(/outline-offset:\s*-1px\s*;/);
  });

  it("one rule drops exactly the PRINT_DROPPED selectors: unselected segments and the Coral edge", () => {
    const drops = rules.filter((r) => r.selectors.includes(PRINT_DROPPED[0]));
    expect(drops).toHaveLength(1);
    expect([...drops[0]!.selectors].sort()).toEqual([...PRINT_DROPPED].sort());
    expect(drops[0]!.body).toMatch(/display:\s*none\s*;/);
  });
});

describe("the dark palette is for the screen only", () => {
  it("is limited by `screen and (prefers-color-scheme: dark)`", () => {
    expect(code).toMatch(/@media\s+screen\s+and\s+\(prefers-color-scheme:\s*dark\)\s*\{/);
  });

  it("the only prefers-color-scheme: dark queries are the osteria one and the Costì product one, both screen-only", () => {
    const all = code.match(/prefers-color-scheme:\s*dark/g) ?? [];
    expect(all).toHaveLength(2);
    const screenOnly =
      code.match(/@media\s+screen\s+and\s+\(prefers-color-scheme:\s*dark\)\s*\{/g) ?? [];
    expect(screenOnly).toHaveLength(2);
    expect(code).not.toMatch(/@media\s+\(prefers-color-scheme:\s*dark\)/);
  });
});
