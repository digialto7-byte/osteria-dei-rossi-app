import { describe, expect, it } from "vitest";
import { makeLine } from "../../helpers/review-line";
import { fieldLabel, lineBadges, lineMeta, summaryText } from "@/lib/invoices/review-view";

const NBSP = " ";

describe("lineMeta", () => {
  it("writes quantity, unit price, amount and VAT on one line", () => {
    expect(lineMeta(makeLine())).toBe(`2${NBSP}kg × 12,75${NBSP}€ = 25,50${NBSP}€ · IVA 10%`);
  });

  it("drops the unit when the line has none", () => {
    expect(lineMeta(makeLine({ unit: null, qty: 2 }))).toBe(
      `2 × 12,75${NBSP}€ = 25,50${NBSP}€ · IVA 10%`,
    );
  });

  it("shows only quantity and amount when the unit price is missing, and no VAT when unknown", () => {
    expect(lineMeta(makeLine({ unitPrice: null, vatRate: null }))).toBe(
      `2${NBSP}kg · 25,50${NBSP}€`,
    );
  });

  it("groups thousands and keeps a fractional VAT rate", () => {
    expect(
      lineMeta(makeLine({ qty: 1, unitPrice: 1234.5, lineAmount: 1234.5, vatRate: 5.5 })),
    ).toBe(`1${NBSP}kg × 1.234,50${NBSP}€ = 1.234,50${NBSP}€ · IVA 5,5%`);
  });

  it("counts whole packs", () => {
    expect(lineMeta(makeLine({ unit: "conf", qty: 3 }))).toContain(`3${NBSP}conf`);
  });
});

describe("fieldLabel", () => {
  it("names every field the server can send in Italian", () => {
    expect(fieldLabel("qty")).toBe("quantità");
    expect(fieldLabel("unit_price")).toBe("prezzo");
    expect(fieldLabel("line_amount")).toBe("importo");
    expect(fieldLabel("vat_rate")).toBe("IVA");
    expect(fieldLabel("number_raw")).toBe("numero");
    expect(fieldLabel("gross_total")).toBe("totale");
  });

  it("shows an unknown field as it is, never hides it", () => {
    expect(fieldLabel("something_new")).toBe("something_new");
  });
});

describe("lineBadges", () => {
  const texts = (over: Parameters<typeof makeLine>[0]) =>
    lineBadges(makeLine(over)).map((badge) => badge.text);

  it("a mapped line that needs nothing has no badge", () => {
    expect(lineBadges(makeLine({ mappingSource: "manual" }))).toEqual([]);
  });

  it("an unmapped stock line says 'Da abbinare' in the warning tone", () => {
    expect(lineBadges(makeLine({ ingredient: null, mappingSource: null, baseQty: null }))).toEqual([
      { id: "unmapped", tone: "warning", text: "Da abbinare" },
    ]);
  });

  it("a non-stock line is not unmapped; it names its cost centre", () => {
    const badges = lineBadges(
      makeLine({
        ingredient: null,
        mappingSource: null,
        isStock: false,
        costCentre: { id: "c1", name: "Pulizie" },
      }),
    );
    expect(badges).toEqual([
      { id: "non-stock", tone: "neutral", text: "Non a magazzino: Pulizie" },
    ]);
  });

  it("a split parent is not unmapped: its parts carry the state", () => {
    expect(
      texts({
        ingredient: null,
        mappingSource: null,
        isSplit: true,
        children: [makeLine(), makeLine()],
      }),
    ).toEqual(["Divisa in 2 parti"]);
  });

  it("names the uncertain fields in words", () => {
    expect(texts({ lowConfidenceFields: ["qty", "unit_price"] })).toEqual([
      "Lettura incerta: quantità, prezzo",
    ]);
  });

  it("a failed amount check is danger, an odd VAT rate is a warning", () => {
    expect(lineBadges(makeLine({ checks: ["amount_mismatch", "vat_rate_unexpected"] }))).toEqual([
      { id: "amount_mismatch", tone: "danger", text: "Importo non torna" },
      { id: "vat_rate_unexpected", tone: "warning", text: "Aliquota IVA insolita" },
    ]);
  });

  it("shows a credit with its quantity and unit", () => {
    expect(texts({ creditQty: 1, creditAmount: 12.75 })).toEqual([`Reso: 1${NBSP}kg`]);
    expect(texts({ creditQty: 0.5, unit: null })).toEqual(["Reso: 0,5"]);
  });

  it("marks corrected lines and lines mapped from memory", () => {
    expect(texts({ corrected: true, correctedFields: ["qty"] })).toEqual(["Corretta"]);
    expect(texts({ mappingSource: "auto" })).toEqual(["Abbinata in automatico"]);
  });
});

describe("summaryText", () => {
  it("says what is left to do, with Italian plurals", () => {
    expect(summaryText({ lines: 10, unmapped: 3, toCheck: 2, corrected: 1 })).toBe(
      "3 righe da abbinare · 2 da controllare · 1 corretta",
    );
    expect(summaryText({ lines: 10, unmapped: 1, toCheck: 0, corrected: 2 })).toBe(
      "1 riga da abbinare · 2 corrette",
    );
  });

  it("says so when there is nothing to do", () => {
    expect(summaryText({ lines: 4, unmapped: 0, toCheck: 0, corrected: 0 })).toBe(
      "Nessuna riga da abbinare o controllare",
    );
    expect(summaryText({ lines: 0, unmapped: 0, toCheck: 0, corrected: 0 })).toBe(
      "Nessuna riga da leggere",
    );
  });
});
