import { buildSignedData } from "./build-cms";
import { bytesOf, fileXml, type BodySpec, type FileSpec } from "./build-xml";

// The demo invoice of the real-stack suites (tests/integration/xml-invoice.int.ts and e2e/xml-invoice.spec.ts): fake data only
// ("Fornitore Demo 1", the checksum-valid fake VAT number the suite already uses, dates in 1998). The buyer of every file is the
// tenant's own VAT number, which the stack makes up per run, so no fixture is a static file. Pure: no vitest, no Playwright.

/** The supplier of every fixture file. */
export const SUPPLIER_VAT = "IT12345678903";
export const SUPPLIER_NAME = "Fornitore Demo 1";

/**
 * One invoice body: two stock lines of kg at 10 % (3 kg x 10,00 and 2 kg x 5,00 = 40,00; VAT 4,00; total 44,00), so the
 * totals gate passes. The first line carries an EAN code and a LOTTO value written as "other data" by the supplier.
 */
export function invoiceBody(numero: string, date: string, over: BodySpec = {}): BodySpec {
  return {
    numero,
    date,
    totale: "44.00",
    lines: [
      {
        desc: "Farina Demo",
        codes: [["EAN", "8000000000001"]],
        qty: "3.00",
        unit: "kg",
        unitPrice: "10.00",
        total: "30.00",
        rate: "10.00",
        other: [{ tipo: "LOTTO", testo: "L-DEMO-0001" }],
      },
      {
        desc: "Olio Demo",
        qty: "2.00",
        unit: "kg",
        unitPrice: "5.00",
        total: "10.00",
        rate: "10.00",
      },
    ],
    summary: [{ rate: "10.00", imponibile: "40.00", imposta: "4.00" }],
    ...over,
  };
}

/** A file addressed to `buyerVat`, from the fixture supplier, with the given bodies. */
export function fatturaXml(buyerVat: string, bodies: BodySpec[], over: FileSpec = {}): Uint8Array {
  return bytesOf(fileXml({ supplierVat: SUPPLIER_VAT, buyerVat, bodies, ...over }));
}

/** The XML wrapped in a CMS envelope, as the tax portal and PEC deliver a signed invoice. Nothing is signed. */
export const asP7m = (xml: Uint8Array): Uint8Array => buildSignedData({ content: xml });
