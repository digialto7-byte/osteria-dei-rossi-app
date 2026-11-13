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
