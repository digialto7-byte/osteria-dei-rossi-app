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
  it("has the five sections", () => {
    const headings = [...guide.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
    expect(headings).toEqual([
      "Il tuo accesso",
      "Se dimentichi la password",
      "Far entrare il personale",
      "Se un telefono si perde",
      "Verifica in due passaggi",
    ]);
  });

  describe("Verifica in due passaggi (P2-1 B9)", () => {
    const section = guide.slice(guide.indexOf("## Verifica in due passaggi"));

    it("says what it is and quotes the real label of the screen", () => {
      expect(section).toContain("«Verifica in due passaggi»");
      expect(section).toMatch(/codice.*telefono|app di autenticazione/i);
    });

    it("says how to turn it on and to add the backup device", () => {
      expect(section).toContain("«Attiva ora»");
      expect(section).toMatch(/riserva/i);
    });

    it("says what to do if the phone is lost, and that only DigiAlto can reset it", () => {
      expect(section).toMatch(/riserva/i);
      expect(section).toContain("DigiAlto");
    });

    it("states no legal rule (only that it is required for admins, which is a product choice)", () => {
      expect(section).not.toMatch(/\b(GDPR|legge|obbligo di legge|normativa|per legge)\b/i);
    });
  });

  it("states the 10-minute life of the e-mail code and the up-to-one-hour window after a password change", () => {
    expect(guide).toContain("Il codice vale 10 minuti");
    expect(guide).toMatch(/fino a un'ora/);
    expect(guide).toMatch(/entro un'ora al massimo/);
    expect(guide).not.toMatch(/60 minuti/);
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
    // P2-1 B9: the reset section names DigiAlto (the only party that can reset the second factor); always with the capital A, never lower-case.
    expect(guide).not.toMatch(/digialto/);
    expect(guide).not.toMatch(/\d{6,}/);
  });
});
