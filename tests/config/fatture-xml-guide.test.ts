import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { it as italian } from "@/lib/i18n/messages/it";

// P2-7 step S20: the owner's guide on paper (docs/guides/fatture-xml.md). Every label it quotes in «…» is a real label of a screen, so the guide cannot drift
// from the app; fragments of a longer sentence and the server's refusal texts are quoted with plain double quotes instead. It states no legal rule and no
// client fact, and says the legal preservation (conservazione) stays where it is today.
const guide = readFileSync(new URL("../../docs/guides/fatture-xml.md", import.meta.url), "utf8");

describe("docs/guides/fatture-xml.md", () => {
  it("has the eight sections", () => {
    const headings = [...guide.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
    expect(headings).toEqual([
      "Dove trovare il file",
      "Caricare il file",
      "Che cosa legge l'app",
      "Che cosa rifiuta",
      "La stessa fattura due volte",
      "Il lotto scritto dal fornitore",
      "Il file firmato (.p7m)",
      "Che cosa non fa",
    ]);
  });

  it("quotes only labels that exist in it.ts", () => {
    const quoted = [...guide.matchAll(/«([^»]+)»/g)].map((m) => m[1]!);
    expect(quoted.length).toBeGreaterThan(20);
    const values = new Set<string>(Object.values(italian));
    for (const label of quoted) expect(values.has(label), label).toBe(true);
  });

  it("names the buttons of the main steps", () => {
    for (const label of [
      "«Carica PDF, foto o file XML»",
      "«Carica»",
      "«Controlla ora ›»",
      "«Approva fattura»",
      "«Dati dal file XML»",
      "«Scadenza pagamento»",
      "«Crea fornitore»",
      "«Usa come lotto»",
      "«Usa come scadenza»",
      "«Usa il file XML al posto del PDF»",
      "«Usa il file XML»",
      "«File firmato (firma non verificata da Costì)»",
    ]) {
      expect(guide).toContain(label);
    }
  });

  it("repeats the refusal texts the server sends, word for word", () => {
    expect(guide).toContain(
      "È una nota di credito (TD04): Costì non la registra ancora. Passala al commercialista.",
    );
    expect(guide).toContain("Questo file è già stato caricato.");
  });

  it("says the file is not verified and that nothing is saved for a refused file", () => {
    expect(guide).toMatch(/non controlla la firma/);
    expect(guide).toMatch(/non viene salvato niente/);
  });

  it("says the copy is not the legal preservation, which stays where it is today", () => {
    expect(guide).toMatch(/non sostituisce la conservazione digitale/);
    expect(guide).toMatch(/resta dove è oggi/);
  });

  it("states no legal rule and no client fact", () => {
    expect(guide).not.toMatch(
      /\b(GDPR|obbligo di legge|per legge|Reg\.|Regolamento|D\.Lgs|normativa)/i,
    );
    expect(guide).toMatch(/commercialista/);
    expect(guide).not.toMatch(/[\w.+-]+@[\w-]+\.[a-z]{2,}/i);
    expect(guide).not.toMatch(/\bIT\d{11}\b/);
  });

  it("uses only invented example names", () => {
    expect(guide).toContain("Fornitore Demo 1");
    expect(guide).toContain("L-DEMO-0001");
  });
});
