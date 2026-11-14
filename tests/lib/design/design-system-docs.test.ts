import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// ADR-045 records "one Costì design system; the venue is a layer" (docs/plans/2026-11-14-ux-p2-design-system.md, D1).

const read = (path: string) => readFileSync(resolve(__dirname, "../../..", path), "utf8");

describe("ADR-045: one Costì design system; the venue is a layer", () => {
  const adr = read("docs/adr/adr-045-one-design-system-venue-layer.md");
  const section = (name: string): string => {
    const start = adr.indexOf(`\n## ${name}\n`);
    expect(start, name).toBeGreaterThan(-1);
    const rest = adr.slice(start + 1);
    const next = rest.indexOf("\n## ", 3);
    return next === -1 ? rest : rest.slice(0, next);
  };

  it("follows the ADR template: a numbered title, status and the four sections", () => {
    expect(adr).toMatch(/^# ADR-045 — /);
    expect(adr).toMatch(/^- \*\*Status:\*\* accepted/m);
    for (const name of ["Context", "Decision", "Alternatives", "Consequences"]) section(name);
  });

  it("names the venue layer, its two refusals, the band property and the CSP it relies on", () => {
    const decision = section("Decision");
    for (const word of [
      "venueLayer",
      "band_ink_contrast",
      "rule_contrast",
      "--color-band",
      "style-src",
      "ADR-028",
    ]) {
      expect(decision, word).toContain(word);
    }
  });

  it("rejects the per-tenant theme table and the other ways to apply an accent", () => {
    const alternatives = section("Alternatives");
    expect(alternatives).toContain("tenant_theme");
    expect(alternatives).toMatch(/rejected/i);
  });
});

describe("ADR-042 after ADR-045", () => {
  it("keeps its accepted status and says which decisions ADR-045 supersedes", () => {
    const adr = read("docs/adr/adr-042-product-theme-scope.md");
    const status = adr.match(/^- \*\*Status:\*\* (.*)$/m)?.[1] ?? "";
    expect(status).toMatch(/^accepted/);
    expect(status).toContain("ADR-045");
  });
});
