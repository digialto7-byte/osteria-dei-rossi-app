import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { it as italian } from "@/lib/i18n/messages/it";

// P2-2 step S20: the owner's guide on paper (docs/guides/tracciabilita.md). Every label it quotes in «…» is a real label of a screen, so the guide cannot drift
// from the app; fragments of a longer sentence are quoted with plain double quotes instead. It states no legal rule and no client fact.
const guide = readFileSync(new URL("../../docs/guides/tracciabilita.md", import.meta.url), "utf8");

describe("docs/guides/tracciabilita.md", () => {
  it("has the six sections", () => {
    const headings = [...guide.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
    expect(headings).toEqual([
      "Trovare un lotto",
      "Che cosa significa quando manca qualcosa",
      "Il lotto in fattura",
      "«Com'è andata» in «Da spingere»",
      "Che cosa vede il cuoco",
      "Che cosa non fa",
    ]);
  });

  it("quotes only labels that exist in it.ts", () => {
    const quoted = [...guide.matchAll(/«([^»]+)»/g)].map((m) => m[1]!);
    expect(quoted.length).toBeGreaterThan(15);
    const values = new Set<string>(Object.values(italian));
    for (const label of quoted) expect(values.has(label), label).toBe(true);
  });

  it("explains the two gap words and the lot nudge", () => {
    for (const label of [
      "«Lotto senza codice»",
      "«Senza lotto»",
      "«Lotto mancante»",
      "«Mostra la prima»",
    ]) {
      expect(guide).toContain(label);
    }
    expect(guide).toMatch(/Dopo l'approvazione non si può più aggiungere/);
    expect(guide).toMatch(/non un obbligo/);
  });

  it("says what the chef sees: no price, no invoice, no article, counts only", () => {
    const section = guide.slice(guide.indexOf("## Che cosa vede il cuoco"));
    expect(section).toMatch(/senza prezzi, senza fattura e senza «Articolo»/);
    expect(section).toMatch(/solo numeri/);
  });

  it("states no legal rule and no client fact, and leaves the duties to the consultant", () => {
    expect(guide).not.toMatch(
      /\b(GDPR|obbligo di legge|per legge|Reg\.|Regolamento|178\/2002|D\.Lgs)/i,
    );
    expect(guide).toMatch(/consulente HACCP/);
    expect(guide).not.toMatch(/[\w.+-]+@[\w-]+\.[a-z]{2,}/i);
    expect(guide).not.toMatch(/\bIT\d{11}\b/);
  });

  it("uses only invented example names", () => {
    expect(guide).toContain("L-DEMO-0001");
    expect(guide).toContain("Farina Demo");
  });
});
