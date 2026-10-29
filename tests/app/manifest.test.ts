import { describe, expect, it } from "vitest";
import manifest from "@/app/manifest";

// M20 plan §3.6.6: the trading name and two brand colours of docs/client-facts.md, and nothing else. No icons until the logo is
// approved (Q121).
describe("web manifest", () => {
  const m = manifest();

  it("names the venue", () => {
    expect(m.name).toBe("Osteria Dei Rossi");
    expect(m.short_name).toBe("Osteria Dei Rossi");
  });

  it("is Italian, standalone, and starts at the root", () => {
    expect(m.lang).toBe("it");
    expect(m.display).toBe("standalone");
    expect(m.start_url).toBe("/");
    expect(m.scope).toBe("/");
  });

  it("uses the two approved colours", () => {
    expect(m.theme_color).toBe("#1C4130");
    expect(m.background_color).toBe("#FFFADF");
  });

  it("has no icons key (Q121: until the logo is approved)", () => {
    expect(m).not.toHaveProperty("icons");
  });
});
