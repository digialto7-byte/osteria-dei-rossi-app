import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { contrastRatio } from "@/lib/design/contrast";
import { AAA_TEXT, HIGH_CONTRAST_PAIRS, THEMES, type Theme } from "@/lib/design/tokens";

// The kitchen's high-contrast mode (M19 plan §3.1.11, PRD accessibility): only pairs of at least 7:1 (WCAG AAA), in both themes.
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
    expect(contrastRatio(THEMES[theme][fg], THEMES[theme][bg])).toBeGreaterThanOrEqual(AAA_TEXT);
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
