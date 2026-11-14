import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { contrastRatio } from "@/lib/design/contrast";
import { AAA_TEXT, HIGH_CONTRAST_PAIRS, PRODUCT_THEMES, type Theme } from "@/lib/design/tokens";

// P2a-11 (docs/plans/2026-11-14-ux-p2-design-system.md): the kitchen's high-contrast pairs and the 44 px tap floor hold on the Costì values,
// the theme every screen moves to. tests/design/kitchen-contrast.test.ts checks the same pairs on the osteria theme until P2j.
const THEME_NAMES: Theme[] = ["light", "dark"];

describe("high-contrast pairs on Costì", () => {
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
