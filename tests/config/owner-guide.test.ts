import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { it as italian } from "@/lib/i18n/messages/it";

// M25a step 15: the owner's guide on paper (docs/guides/accesso-e-personale.md). Every label it quotes in «…» is
// a real label of the screen, so the guide cannot drift from the app; it states no client fact but the trading name.
const guide = readFileSync(
  new URL("../../docs/guides/accesso-e-personale.md", import.meta.url),
  "utf8",
);

describe("docs/guides/accesso-e-personale.md", () => {
  it("has the four sections", () => {
    const headings = [...guide.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
    expect(headings).toEqual([
      "Il tuo accesso",
      "Se dimentichi la password",
      "Far entrare il personale",
      "Se un telefono si perde",
    ]);
  });

  it("quotes only labels that exist in it.ts", () => {
    const quoted = [...guide.matchAll(/«([^»]+)»/g)].map((m) => m[1]!);
    expect(quoted.length).toBeGreaterThan(8);
    const values = new Set<string>(Object.values(italian));
    for (const label of quoted) expect(values.has(label), label).toBe(true);
  });

  it("quotes the labels of the sign-in screen by name", () => {
    for (const label of [
      "Accedi con la password",
      "Inviami il link",
      "Entra con il codice",
      "Salva password",
      "Abilita questo telefono per il personale",
      "Revoca",
    ]) {
      expect(guide).toContain(`«${label}»`);
    }
  });

  it("has no address, no link and no client fact other than the trading name", () => {
    expect(guide).not.toContain("@");
    expect(guide).not.toMatch(/http/i);
    expect(guide).toContain("Osteria Dei Rossi");
    expect(guide).not.toMatch(/digialto/i);
    expect(guide).not.toMatch(/\d{6,}/);
  });
});
