import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

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
