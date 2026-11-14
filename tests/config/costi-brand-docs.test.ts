import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { contrastRatio } from "@/lib/design/contrast";
import { CONTRAST_PAIRS, COLOR_TOKENS, PRODUCT_THEMES } from "@/lib/design/tokens";

// Costì product brand plan (docs/plans/2026-11-13-costi-product-brand.md): the documents of the brand step.
const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

describe("docs/client-facts.md, product section (CB1)", () => {
  const text = read("docs/client-facts.md");
  const heading = "\n## Product (DigiAlto)\n";

  it("has the product heading after the client list and before the draft client data", () => {
    const at = text.indexOf(heading);
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeGreaterThan(text.indexOf("\n- Booking hours per service:"));
    expect(at).toBeLessThan(text.indexOf("\n## Draft client data"));
  });

  it("names the product and carries the five brand colours and the two fonts", () => {
    const section = text.slice(text.indexOf(heading), text.indexOf("\n## Draft client data"));
    expect(section).toContain("- Product name: Costì");
    for (const hex of ["#0E4D3A", "#FF7A5C", "#DCEDE6", "#F7F8F6", "#1F2933"]) {
      expect(section, hex).toContain(hex);
    }
    expect(section).toContain("Product fonts: Montserrat");
    expect(section).toContain("Inter (body and tables)");
    expect(section).toContain("Not approved (product): the Costì logo.");
  });

  it("leaves the client's trading name line unchanged", () => {
    expect(text).toContain("\n- Trading name: Osteria Dei Rossi (founder-approved 2026-10-22)\n");
  });
});

describe("docs/adr/adr-042-product-theme-scope.md (CB9)", () => {
  const path = "docs/adr/adr-042-product-theme-scope.md";
  const adr = read(path);
  const section = (name: string) => {
    const start = adr.indexOf(`\n## ${name}\n`);
    expect(start, name).toBeGreaterThan(-1);
    const rest = adr.slice(start + 1);
    const next = rest.indexOf("\n## ", 3);
    return next === -1 ? rest : rest.slice(0, next);
  };

  it("follows the ADR template: a numbered title, status, date and the four sections", () => {
    expect(adr).toMatch(/^# ADR-042 — /);
    expect(adr).toMatch(/^- \*\*Status:\*\* accepted/m);
    expect(adr).toMatch(/^- \*\*Date:\*\* 2026-11-13 · \*\*Decided by:\*\* founder/m);
    for (const name of ["Context", "Decision", "Alternatives", "Consequences"]) section(name);
  });

  it("names the scope attribute, the token sets and the contrast pairs it is checked against", () => {
    const decision = section("Decision");
    expect(decision).toContain("data-brand");
    expect(decision).toContain("PRODUCT_THEMES");
    expect(decision).toContain("CONTRAST_PAIRS");
    expect(decision).toContain(":root:has(");
  });

  it("gives the phase-3 contract: a theme is a full value set for COLOR_TOKENS, contrast-checked in both themes, applied by a scope", () => {
    const decision = section("Decision");
    expect(decision).toContain("COLOR_TOKENS");
    expect(decision).toMatch(/both themes/i);
    expect(decision).toMatch(/phase 3/i);
  });

  it("rejects at least the new-token-names alternative (A2)", () => {
    const alternatives = section("Alternatives");
    expect(alternatives).toContain("--color-costi-");
    expect(alternatives).toMatch(/rejected|not chosen|why not/i);
  });
});

describe("docs/design/ui-foundation.md, section 11 Product theme (Costì) (CB10)", () => {
  const doc = read("docs/design/ui-foundation.md");
  const start = doc.indexOf("\n## 11. Product theme (Costì)\n");
  const section = start === -1 ? "" : doc.slice(start + 1);

  it("exists, after section 10", () => {
    expect(start).toBeGreaterThan(doc.indexOf("\n## 10. Verification and screenshots\n"));
  });

  it("has a token table that equals PRODUCT_THEMES, one row per token, light and dark", () => {
    const rows = [
      ...section.matchAll(/^\| `([a-z-]+)` \| `(#[0-9A-F]{6})` \| `(#[0-9A-F]{6})` \|/gm),
    ];
    const light: Record<string, string> = {};
    const dark: Record<string, string> = {};
    for (const [, token, l, d] of rows) {
      light[token!] = l!;
      dark[token!] = d!;
    }
    expect(rows).toHaveLength(COLOR_TOKENS.length);
    expect(light).toEqual(PRODUCT_THEMES.light);
    expect(dark).toEqual(PRODUCT_THEMES.dark);
  });

  it("lists every contrast pair with the ratios the tests compute, in both themes", () => {
    const ratio = (
      theme: "light" | "dark",
      fg: (typeof COLOR_TOKENS)[number],
      bg: (typeof COLOR_TOKENS)[number],
    ) => contrastRatio(PRODUCT_THEMES[theme][fg], PRODUCT_THEMES[theme][bg]).toFixed(2);
    for (const pair of CONTRAST_PAIRS) {
      const row = `| \`${pair.fg}\` on \`${pair.bg}\` | ${pair.min} | ${ratio("light", pair.fg, pair.bg)} | ${ratio("dark", pair.fg, pair.bg)} |`;
      expect(section, row).toContain(row);
    }
  });

  it("covers the fonts, the logo slots and the scope rule", () => {
    expect(section).toContain("Montserrat");
    expect(section).toContain("Inter");
    expect(section).toContain("public/brand/costi/");
    expect(section).toContain("data-brand");
    expect(section).toContain("ADR-042");
    expect(section).toContain("docs/plans/2026-11-13-costi-product-brand.md");
  });

  it("sends the section-9 logo and PWA-icon TODOs to section 11 for the product", () => {
    const nine = doc.slice(doc.indexOf("\n## 9. Open items and TODO\n"), doc.indexOf("\n## 10. "));
    const logo = nine.slice(
      nine.indexOf("- **TODO, logo:**"),
      nine.indexOf("- **TODO, PWA icon:**"),
    );
    const icon = nine.slice(
      nine.indexOf("- **TODO, PWA icon:**"),
      nine.indexOf("- **Client facts:**"),
    );
    expect(logo).toContain("section 11");
    expect(icon).toContain("section 11");
  });
});
