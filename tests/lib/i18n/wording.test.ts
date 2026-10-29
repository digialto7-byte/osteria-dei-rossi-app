import { describe, expect, it } from "vitest";
import { en } from "@/lib/i18n/messages/en";
import { it as italian } from "@/lib/i18n/messages/it";

// UX plan C9 (P2-9, L5 and L6), without variant V1 (the founder has not answered Q3 on the other renames):
// - the nav section that imports master data and recipes is called "Importa dati", as the page does more than
//   "anagrafiche";
// - the line after an approval says "pagamento", the word the rest of the app uses ("Pagamenti"), not "debito".

describe("wording (C9)", () => {
  it("names the import section 'Importa dati' (en: 'Import data')", () => {
    expect(italian["nav.import"]).toBe("Importa dati");
    expect(en["nav.import"]).toBe("Import data");
  });

  it("says 'pagamento' and not 'debito' after an approval", () => {
    expect(italian["approval.done"]).toBe("Carichi e pagamento registrati. Non si può annullare.");
    expect(italian["approval.done"]).not.toMatch(/debito/i);
  });

  it("leaves the renames of variant V1 alone", () => {
    expect(italian["nav.reorder"]).toBe("Riordino");
    expect(italian["nav.main"]).toBe("Menu principale");
    expect(italian["approval.done"]).not.toContain("Carico e");
  });

  it("keeps the import button on the import page as the plain verb 'Importa'", () => {
    expect(italian["import.submit"]).toBe("Importa");
    expect(italian["import.confirm"]).toBe("Importa");
  });
});
