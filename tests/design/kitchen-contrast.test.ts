import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { contrastRatio } from "@/lib/design/contrast";
import { AAA_TEXT, HIGH_CONTRAST_PAIRS, PRODUCT_THEMES, type Theme } from "@/lib/design/tokens";

// The kitchen's high-contrast mode (M19 plan §3.1.11, PRD accessibility): only pairs of at least 7:1 (WCAG AAA), in both themes, on the one
// shipped theme (Costì, PRODUCT_THEMES; DS-BQ-1, Q-L1). This file also holds what tests/lib/design/costi-contrast.test.ts checked (P2a-11):
// that file's cases, the quoted ratios and the 44 px tap floor were merged here in P2j (lead, Q1) and the old file was deleted.
const THEME_NAMES: Theme[] = ["light", "dark"];

describe("kitchen high-contrast pairs", () => {
  it("asks for 7:1 everywhere", () => {
    expect(AAA_TEXT).toBe(7);
    for (const pair of HIGH_CONTRAST_PAIRS) expect(pair.min).toBe(AAA_TEXT);
  });

  const cases = THEME_NAMES.flatMap((theme) =>
    HIGH_CONTRAST_PAIRS.map((pair) => [theme, pair.fg, pair.bg, pair.use] as const),
  );
  it.each(cases)("%s: %s on %s reaches 7:1 (%s)", (theme, fg, bg) => {
    expect(
      contrastRatio(PRODUCT_THEMES[theme][fg], PRODUCT_THEMES[theme][bg]),
    ).toBeGreaterThanOrEqual(AAA_TEXT);
  });

  it("pins the ratios the plan quotes (13.85, 14.76/11.68, 12.15/9.61, 13.85)", () => {
    const ratio = (theme: Theme, fg: "ink" | "paper", bg: "paper" | "surface" | "sunk" | "ink") =>
      contrastRatio(PRODUCT_THEMES[theme][fg], PRODUCT_THEMES[theme][bg]).toFixed(2);
    expect(ratio("light", "ink", "paper")).toBe("13.85");
    expect(ratio("light", "ink", "surface")).toBe("14.76");
    expect(ratio("dark", "ink", "surface")).toBe("11.68");
    expect(ratio("light", "ink", "sunk")).toBe("12.15");
    expect(ratio("dark", "ink", "sunk")).toBe("9.61");
    expect(ratio("light", "paper", "ink")).toBe("13.85");
  });

  it("never uses the muted text colour in this mode", () => {
    for (const pair of HIGH_CONTRAST_PAIRS) {
      expect(pair.fg).not.toBe("ink-muted");
      expect(pair.fg).not.toBe("gold");
      expect(pair.fg).not.toBe("highlight");
    }
  });

  it("globals.css turns the muted ink into ink and draws 2 px ink borders under data-contrast=high", () => {
    const css = readFileSync(new URL("../../src/app/globals.css", import.meta.url), "utf8");
    const block = css.slice(css.indexOf('[data-contrast="high"]'));
    expect(block).toContain("--color-ink-muted: var(--color-ink)");
    expect(block).toMatch(/border-color:\s*var\(--color-ink\)/);
    expect(block).toMatch(/border-width:\s*2px/);
  });
});

describe("the tap floor in globals.css", () => {
  const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
  const theme = css.slice(css.indexOf("@theme {"), css.indexOf("/* Light theme colours"));

  it("--spacing-tap is at least 2.75rem (44 px)", () => {
    const match = /--spacing-tap:\s*([\d.]+)rem;/.exec(theme);
    expect(Number(match?.[1])).toBeGreaterThanOrEqual(2.75);
  });

  it("its comment names WCAG 2.2 success criteria 2.5.5 (target size, enhanced) and 2.5.8 (minimum)", () => {
    const comment = /\/\*([^*]|\*(?!\/))*\*\/\s*--spacing-tap:/.exec(theme)?.[0] ?? "";
    expect(comment).toContain("WCAG 2.2");
    expect(comment).toContain("SC 2.5.5");
    expect(comment).toContain("SC 2.5.8");
  });
});
