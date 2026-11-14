import { describe, expect, it } from "vitest";
import {
  bodyPositionText,
  downloadLabel,
  duplicateBanner,
  headerChipText,
  isForeignVat,
  lineCodeText,
  lineDiscountText,
  lineKindText,
  otherDataValues,
  signedText,
  vatRowText,
} from "@/lib/invoices/xml-review-view";
import {
  makeXmlReview,
  partner,
  PARTNER_ID,
  lineXml,
  xmlInfo,
  xmlLine,
} from "../../helpers/review-xml";

const NBSP = " ";

describe("header chips", () => {
  it("names the file kind and the document type with the server's label and the code", () => {
    expect(headerChipText(xmlInfo())).toBe("Fattura elettronica · Fattura (TD01)");
    expect(
      headerChipText(
        xmlInfo({
          documentType: "TD24",
          documentTypeLabel: "Fattura differita (art. 21 c. 4 lett. a)",
        }),
      ),
    ).toBe("Fattura elettronica · Fattura differita (art. 21 c. 4 lett. a) (TD24)");
  });

  it("says which invoice of the file it is only when the file holds several", () => {
    expect(bodyPositionText(xmlInfo())).toBeNull();
    expect(bodyPositionText(xmlInfo({ bodyIndex: 2, bodyCount: 3 }))).toBe(
      "Fattura 2 di 3 nello stesso file",
    );
  });

  it("says a p7m was opened and its signature not verified", () => {
    expect(signedText(xmlInfo())).toBeNull();
    expect(signedText(xmlInfo({ signed: true }))).toBe(
      "File firmato (firma non verificata da Costì)",
    );
  });

  it("gives the download link its file type", () => {
    expect(downloadLabel(xmlInfo())).toBe("Scarica il file originale (XML)");
    expect(downloadLabel(xmlInfo({ signed: true }))).toBe(
      "Scarica il file originale (P7M firmato)",
    );
  });
});

describe("vatRowText", () => {
  it("writes a rate row with its taxable amount and tax", () => {
    expect(vatRowText({ rate: 22, nature: null, natureLabel: null, taxable: 100, tax: 22 })).toBe(
      `22% · imponibile 100,00${NBSP}€ · IVA 22,00${NBSP}€`,
    );
  });

  it("writes a nature row with the server's label and the code, and no tax", () => {
    expect(vatRowText({ rate: 0, nature: "N4", natureLabel: "Esenti", taxable: 10, tax: 0 })).toBe(
      `Esenti (N4) · imponibile 10,00${NBSP}€`,
    );
  });

  it("writes the code alone when the server sent no label", () => {
    expect(vatRowText({ rate: 0, nature: "N9", natureLabel: null, taxable: 5, tax: 0 })).toBe(
      `N9 · imponibile 5,00${NBSP}€`,
    );
  });

  it("keeps a decimal rate as the Italians write it", () => {
    expect(vatRowText({ rate: 5.5, nature: null, natureLabel: null, taxable: 1, tax: 0.06 })).toBe(
      `5,5% · imponibile 1,00${NBSP}€ · IVA 0,06${NBSP}€`,
    );
  });
});

describe("line facts", () => {
  it("names the kind of a line the file marked, and the residual line with its rate", () => {
    expect(lineKindText(xmlLine({}, { kind: "AC" }))).toBe("Spesa accessoria");
    expect(lineKindText(xmlLine({ vatRate: 22 }, { kind: "residual" }))).toBe(
      "Differenza dal riepilogo IVA 22%",
    );
    expect(lineKindText(xmlLine({}, { kind: "SC" }))).toBe("Sconto");
    expect(lineKindText(xmlLine({}, { kind: null }))).toBeNull();
    expect(lineKindText(xmlLine())).toBeNull();
  });

  it("is nothing for a line with no file data", () => {
    expect(lineKindText({ ...xmlLine(), xml: null })).toBeNull();
  });

  it("writes the first code of the file", () => {
    expect(
      lineCodeText(
        lineXml({
          codes: [
            { type: "EAN", value: "8000000000001" },
            { type: "X", value: "2" },
          ],
        }),
      ),
    ).toBe("Cod. EAN 8000000000001");
    expect(lineCodeText(lineXml())).toBeNull();
  });

  it("writes the price before the discounts", () => {
    expect(
      lineDiscountText(
        lineXml({ listUnitPrice: 10, discounts: [{ type: "SC", percent: 10, amount: null }] }),
      ),
    ).toBe(`Prezzo 10,00${NBSP}€ − sconto 10%`);
  });

  it("writes an amount discount, a surcharge, several, and no price when the file had none", () => {
    expect(
      lineDiscountText(
        lineXml({
          listUnitPrice: 10,
          discounts: [
            { type: "SC", percent: null, amount: 1 },
            { type: "MG", percent: 2.5, amount: null },
          ],
        }),
      ),
    ).toBe(`Prezzo 10,00${NBSP}€ − sconto 1,00${NBSP}€ − maggiorazione 2,5%`);
    expect(
      lineDiscountText(lineXml({ discounts: [{ type: "SC", percent: 10, amount: null }] })),
    ).toBe("Applicato: sconto 10%");
  });

  it("is nothing without discounts", () => {
    expect(lineDiscountText(lineXml({ listUnitPrice: 10 }))).toBeNull();
  });
});

describe("otherDataValues", () => {
  it("offers a lot for a text and an expiry for a date, and nothing for a number", () => {
    const values = otherDataValues(
      lineXml({
        otherData: [
          { type: "LOTTO", text: "L-DEMO-0001", number: null, date: null },
          { type: "SCAD", text: null, number: null, date: "1998-12-01" },
          { type: "PESO", text: null, number: 12.5, date: null },
        ],
      }),
    );
    expect(values.map((v) => [v.label, v.display, v.use])).toEqual([
      ["LOTTO", "L-DEMO-0001", { kind: "lot", value: "L-DEMO-0001" }],
      ["SCAD", "01/12/1998", { kind: "expiry", value: "1998-12-01" }],
      ["PESO", "12,5", null],
    ]);
  });

  it("offers no lot for a text over 64 characters and says why", () => {
    const long = "L".repeat(65);
    const [value] = otherDataValues(
      lineXml({ otherData: [{ type: "LOTTO", text: long, number: null, date: null }] }),
    );
    expect(value).toMatchObject({ use: null, tooLong: true, display: long });
    const [edge] = otherDataValues(
      lineXml({ otherData: [{ type: "LOTTO", text: "L".repeat(64), number: null, date: null }] }),
    );
    expect(edge).toMatchObject({ tooLong: false, use: { kind: "lot" } });
  });

  it("shows a date that is not a real date as written, with no button", () => {
    const [value] = otherDataValues(
      lineXml({ otherData: [{ type: "SCAD", text: null, number: null, date: "1998-13-45" }] }),
    );
    expect(value).toMatchObject({ display: "1998-13-45", use: null });
  });

  it("is empty with no other data", () => {
    expect(otherDataValues(lineXml())).toEqual([]);
  });
});

describe("isForeignVat", () => {
  it.each([
    ["IT12345678903", false],
    ["DE123456789", true],
    ["FR12345678901", true],
    [null, false],
    ["", false],
  ])("%s → %s", (vat, expected) => expect(isForeignVat(vat)).toBe(expected));
});

describe("duplicateBanner", () => {
  /** The invoice on screen (an XML in `duplicate`, or a photo in `review`) against a partner. */
  const review = (
    partnerOver: Parameters<typeof partner>[0],
    { xml = true, replace = false }: { xml?: boolean; replace?: boolean } = {},
  ) => {
    const base = makeXmlReview([], {
      duplicatePartner: partner(partnerOver),
      replaceWithXml: replace ? { partnerId: PARTNER_ID } : null,
    });
    return {
      ...base,
      invoice: {
        ...base.invoice,
        status: xml ? ("duplicate" as const) : ("review" as const),
        xml: xml ? base.invoice.xml : null,
      },
    };
  };

  it("1: an XML that duplicates a photo still in review offers to replace it, with the figures in words", () => {
    const banner = duplicateBanner(
      review({ format: "document", status: "review" }, { replace: true }),
    )!;
    expect(banner).toMatchObject({
      id: 1,
      text: "Questa fattura è già presente da foto/PDF (da controllare).",
      partnerLabel: "FT 12 del 03/11/1998",
      partnerHref: `/fatture/${PARTNER_ID}`,
      amounts: "Importi uguali.",
      primary: "replace",
      primaryLabel: "Usa il file XML al posto del PDF",
      canClear: true,
      rejectLabel: "Rifiuta questo file",
      note: null,
    });
  });

  it("2: an XML that duplicates an approved photo can only be rejected, and the amounts are compared in words", () => {
    const banner = duplicateBanner(
      review({ format: "document", status: "approved", grossTotal: 1230, amountsMatch: false }),
    )!;
    expect(banner).toMatchObject({
      id: 2,
      text: "Già approvata da foto/PDF.",
      amounts: `Importi diversi: 132,00${NBSP}€ qui, 1.230,00${NBSP}€ approvati.`,
      primary: "reject",
      primaryLabel: "Rifiuta questo file",
      canClear: false,
      note: "Il file resta in archivio.",
    });
  });

  it("3: a photo or PDF that duplicates an XML is rejected as a copy", () => {
    const banner = duplicateBanner(review({ format: "xml", status: "review" }, { xml: false }))!;
    expect(banner).toMatchObject({
      id: 3,
      text: "Esiste già il file XML di questa fattura.",
      primary: "reject",
      primaryLabel: "Rifiuta questa copia",
      canClear: true,
    });
  });

  it("4: an XML that duplicates another XML is rejected", () => {
    const banner = duplicateBanner(
      review({ format: "xml", status: "review", amountsMatch: false, grossTotal: 99 }),
    )!;
    expect(banner).toMatchObject({
      id: 4,
      text: "Doppione di un altro file XML.",
      primary: "reject",
      primaryLabel: "Rifiuta",
      canClear: true,
      amounts: `Importi diversi: 132,00${NBSP}€ qui, 99,00${NBSP}€ nell'altra.`,
    });
  });

  it("says nothing about the amounts when one total is missing (nothing is guessed)", () => {
    const banner = duplicateBanner(
      review({ format: "xml", status: "review", amountsMatch: null, grossTotal: null }),
    )!;
    expect(banner.amounts).toBeNull();
  });

  it("is null with no partner, for two documents, and for an XML whose photo cannot be replaced", () => {
    expect(duplicateBanner({ ...review({}), duplicatePartner: null })).toBeNull();
    expect(duplicateBanner(review({ format: "document" }, { xml: false }))).toBeNull();
    expect(duplicateBanner(review({ format: "document", status: "review" }))).toBeNull();
  });

  it("is null once the invoice is decided", () => {
    const decided = review({ format: "xml" });
    expect(
      duplicateBanner({ ...decided, invoice: { ...decided.invoice, status: "approved" } }),
    ).toBeNull();
  });
});
