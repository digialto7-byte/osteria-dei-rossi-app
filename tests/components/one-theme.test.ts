import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as tokens from "@/lib/design/tokens";

// P2j (ADR-045, docs/ux/costi-design-system.md §11 step 9): there is one theme, Costì, at `:root`. The osteria theme, the `data-brand` switch,
// the `CostiTheme` marker and the Bodoni Moda and Figtree faces are gone, and nothing may bring them back. This replaces the re-skin order guard
// (costi-theme-order.test.ts, deleted): its D5 rules (no hand-made <dl>, tablist or display-font heading) now hold for every file under src/app.
const ROOT = process.cwd();
const filesOf = (dir: string): string[] =>
  readdirSync(join(ROOT, dir)).flatMap((name) => {
    const path = `${dir}/${name}`;
    return statSync(join(ROOT, path)).isDirectory() ? filesOf(path) : [path];
  });
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

// Any use of the display face, as strict as the old substring guard: the utility class, `var(--font-display)`, `font-(family-name:--font-display)`,
// `[font-family:var(--font-display)]` and the raw next/font variable `--font-display-face`. The root layout is the one file that may name it,
// because it declares that variable (P2j review).
const FONT_DISPLAY = /font-display/;
const FONT_DISPLAY_DECLARED_IN = "src/app/layout.tsx";

const SRC = filesOf("src").filter((file) => /\.(ts|tsx|css)$/.test(file));
// The components that define the type ramp, and two display faces (docs plan 2026-11-14 §4.4).
const FONT_DISPLAY_ALLOWED = [
  "src/components/ui.tsx",
  "src/components/brand.tsx",
  "src/app/(public)/login/login-screen.tsx",
  "src/app/(owner)/cucina/ticket-card.tsx",
];

describe("there is one theme", () => {
  it("(a) no source file names the switch, the marker or the retired faces, and the marker component is gone", () => {
    expect(SRC.length).toBeGreaterThan(100);
    const offenders = SRC.filter((file) =>
      /data-brand|CostiTheme|costi-theme|bodoni|figtree/i.test(read(file)),
    );
    expect(offenders).toEqual([]);
    expect(existsSync(join(ROOT, "src/components/costi-theme.tsx"))).toBe(false);
  });

  it("(b) no file under src/app but the API has a <dl>, a role=tablist, or font-display outside the four allowed files", () => {
    // .ts and .tsx only, as the old guard: globals.css defines the --font-display variable itself.
    const app = SRC.filter(
      (file) =>
        file.startsWith("src/app/") && !file.startsWith("src/app/api/") && !file.endsWith(".css"),
    );
    expect(app.length).toBeGreaterThan(100);
    for (const file of app) {
      const source = read(file);
      expect(source, `${file}: a <dl>: use FactList`).not.toMatch(/<dl[\s>]/);
      expect(source, `${file}: role="tablist": use SegmentedControl`).not.toMatch(/role="tablist"/);
      if (!FONT_DISPLAY_ALLOWED.includes(file) && file !== FONT_DISPLAY_DECLARED_IN) {
        expect(source, `${file}: font-display: use Heading or SubHeading`).not.toMatch(
          FONT_DISPLAY,
        );
      }
    }
  });

  it("(b) catches every way of setting the display face, the raw --font-display-face variable included; only the root layout declares it", () => {
    for (const use of [
      'className="font-display"',
      "font-family: var(--font-display)",
      'className="font-(family-name:--font-display)"',
      'className="[font-family:var(--font-display)]"',
      'className="[font-family:var(--font-display-face)]"',
    ]) {
      expect(use, use).toMatch(FONT_DISPLAY);
    }
    expect(read(FONT_DISPLAY_DECLARED_IN)).toContain('variable: "--font-display-face"');
  });

  it("(c) globals.css has no :root:has() switch, one paper declaration per palette block (@theme, screen-dark :root, print :root) and one screen-dark query", () => {
    const css = read("src/app/globals.css");
    expect(css).not.toMatch(/:root:has\(/);
    expect(css).not.toContain("data-brand");
    // `--color-paper` is declared once in each of the three blocks (the exact values are pinned by tokens.test.ts and print-css.test.ts).
    expect(css.match(/--color-paper:\s*#[0-9a-fA-F]{6}/g)).toHaveLength(3);
    expect(css.match(/@media screen and \(prefers-color-scheme: dark\)/g)).toHaveLength(1);
  });

  it("(d) tokens.ts exports no osteria palette: no THEMES, BRAND or DERIVED", () => {
    expect(Object.keys(tokens)).toEqual(
      expect.arrayContaining(["PRODUCT_THEMES", "PRODUCT_BRAND"]),
    );
    for (const name of ["THEMES", "BRAND", "DERIVED"])
      expect(tokens, name).not.toHaveProperty(name);
  });
});
