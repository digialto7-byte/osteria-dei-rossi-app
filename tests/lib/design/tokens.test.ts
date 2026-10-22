import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { contrastRatio, parseHex, relativeLuminance } from "@/lib/design/contrast";
import {
  AA_NON_TEXT,
  AA_TEXT,
  ACCENT_ONLY,
  BRAND,
  COLOR_TOKENS,
  CONTRAST_PAIRS,
  THEMES,
  type Theme,
} from "@/lib/design/tokens";

const THEME_NAMES: Theme[] = ["light", "dark"];

describe("contrast maths", () => {
  it("parses #RRGGBB in either case", () => {
    expect(parseHex("#B4472b")).toEqual([180, 71, 43]);
  });

  it.each(["B4472B", "#fff", "#12345G", "#1234567"])("rejects %s", (bad) => {
    expect(() => parseHex(bad)).toThrow(TypeError);
  });

  it("gives white luminance 1 and black 0", () => {
    expect(relativeLuminance("#FFFFFF")).toBeCloseTo(1, 6);
    expect(relativeLuminance("#000000")).toBe(0);
  });

  it("matches the WCAG reference values and is symmetric", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 6);
    expect(contrastRatio("#FFFFFF", "#FFFFFF")).toBe(1);
    // #767676 on white is the well-known 4.54:1 boundary grey.
    expect(contrastRatio("#767676", "#FFFFFF")).toBeCloseTo(4.54, 2);
    expect(contrastRatio("#FFFFFF", "#767676")).toBe(contrastRatio("#767676", "#FFFFFF"));
  });
});

describe("design tokens meet WCAG AA in both themes", () => {
  it("defines every token in both themes as #RRGGBB", () => {
    for (const theme of THEME_NAMES) {
      expect(Object.keys(THEMES[theme]).sort()).toEqual([...COLOR_TOKENS].sort());
      for (const value of Object.values(THEMES[theme])) expect(value).toMatch(/^#[0-9A-F]{6}$/);
    }
  });

  it("uses only AA thresholds (4.5:1 text, 3:1 UI boundaries)", () => {
    for (const pair of CONTRAST_PAIRS) expect([AA_TEXT, AA_NON_TEXT]).toContain(pair.min);
  });

  const cases = THEME_NAMES.flatMap((theme) =>
    CONTRAST_PAIRS.map((pair) => [theme, pair.fg, pair.bg, pair.min, pair.use] as const),
  );

  it.each(cases)("%s: %s on %s reaches %s:1 (%s)", (theme, fg, bg, min) => {
    expect(contrastRatio(THEMES[theme][fg], THEMES[theme][bg])).toBeGreaterThanOrEqual(min);
  });

  it("checks every semantic text colour against its own background", () => {
    for (const tone of ["success", "warning", "danger", "info"] as const) {
      expect(CONTRAST_PAIRS).toContainEqual(
        expect.objectContaining({ fg: tone, bg: `${tone}-bg`, min: AA_TEXT }),
      );
    }
  });
});

describe("the palette is the Osteria dei Rossi brand (menu site, draft client fact)", () => {
  it("light, the primary theme: cream paper, green action, black and soft ink", () => {
    expect(THEMES.light.paper).toBe(BRAND.cream);
    expect(THEMES.light.sunk).toBe(BRAND.creamDeep);
    expect(THEMES.light.rule).toBe(BRAND.rule);
    expect(THEMES.light.accent).toBe(BRAND.green);
    expect(THEMES.light["on-accent"]).toBe(BRAND.cream);
    expect(THEMES.light.ink).toBe(BRAND.black);
    expect(THEMES.light["ink-muted"]).toBe(BRAND.soft);
  });

  it("dark: black paper with the on-black inks", () => {
    expect(THEMES.dark.paper).toBe(BRAND.black);
    expect(THEMES.dark.ink).toBe(BRAND.onBlack);
    expect(THEMES.dark["ink-muted"]).toBe(BRAND.onBlackSoft);
  });

  it("gold and yellow are the brand accents in both themes", () => {
    for (const theme of THEME_NAMES) {
      expect(THEMES[theme].gold).toBe(BRAND.gold);
      expect(THEMES[theme].highlight).toBe(BRAND.yellow);
    }
  });

  it("gold and yellow would fail AA as text on cream, so they are accent-only", () => {
    for (const token of ACCENT_ONLY) {
      expect(contrastRatio(THEMES.light[token], THEMES.light.paper)).toBeLessThan(AA_TEXT);
      expect(CONTRAST_PAIRS.some((pair) => pair.fg === token && pair.min === AA_TEXT)).toBe(false);
    }
  });

  it("no component sets an accent-only token as a text colour", () => {
    const files = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        return statSync(path).isDirectory() ? files(path) : [path];
      });
    const textUse = new RegExp(`\\btext-(${ACCENT_ONLY.join("|")})\\b`);
    const offenders = files(join(process.cwd(), "src"))
      .filter((file) => /\.(tsx?|css)$/.test(file))
      .filter((file) => textUse.test(readFileSync(file, "utf8")));
    expect(offenders).toEqual([]);
  });
});

/** The `--color-*` declarations of one block of globals.css, keyed by token name. */
function colorDeclarations(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [, name = "", value = ""] of block.matchAll(
    /--color-([a-z-]+):\s*(#[0-9a-fA-F]{6})\s*;/g,
  )) {
    out[name] = value.toUpperCase();
  }
  return out;
}

describe("globals.css (the runtime source) matches src/lib/design/tokens.ts", () => {
  const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
  const themeStart = css.indexOf("@theme {");
  const inlineStart = css.indexOf("@theme inline");
  const darkStart = css.indexOf("@media (prefers-color-scheme: dark)");
  const baseStart = css.indexOf("@layer base");

  it("has the light @theme block, then the dark override", () => {
    expect(themeStart).toBeGreaterThanOrEqual(0);
    expect(inlineStart).toBeGreaterThan(themeStart);
    expect(darkStart).toBeGreaterThan(inlineStart);
    expect(baseStart).toBeGreaterThan(darkStart);
  });

  it("declares the light colours exactly as THEMES.light", () => {
    expect(colorDeclarations(css.slice(themeStart, inlineStart))).toEqual(THEMES.light);
  });

  it("declares the dark colours exactly as THEMES.dark", () => {
    expect(colorDeclarations(css.slice(darkStart, baseStart))).toEqual(THEMES.dark);
  });

  it("declares no colour token outside those two blocks", () => {
    const elsewhere =
      css.slice(0, themeStart) + css.slice(inlineStart, darkStart) + css.slice(baseStart);
    expect(colorDeclarations(elsewhere)).toEqual({});
  });

  it("the rise keeps `backwards` fill, so it never pins a child's transform after it ends", () => {
    expect(css).toMatch(/--animate-rise:\s*rise \S+ \S+ backwards;/);
  });

  it("keeps the reduced-motion override, including animation delays", () => {
    const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(reduced).toMatch(/animation-duration:\s*0\.01ms !important/);
    expect(reduced).toMatch(/animation-delay:\s*0s !important/);
    expect(reduced).toMatch(/transition-duration:\s*0\.01ms !important/);
  });
});
