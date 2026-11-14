import type {
  DuplicatePartner,
  InvoiceReview,
  ReviewInvoiceXml,
  ReviewLine,
  ReviewLineXml,
} from "@/server/invoices/review-types";
import { makeLine, makeReview } from "./review-line";

/** What the server sends for a TD01 file read from one body. */
export const xmlInfo = (over: Partial<ReviewInvoiceXml> = {}): ReviewInvoiceXml => ({
  format: "FPR12",
  documentType: "TD01",
  documentTypeLabel: "Fattura",
  signed: false,
  bodyIndex: 1,
  bodyCount: 1,
  notes: [],
  ...over,
});

/** The file's data of one line. */
export const lineXml = (over: Partial<ReviewLineXml> = {}): ReviewLineXml => ({
  lineNumber: 1,
  kind: null,
  codes: [],
  otherData: [],
  discounts: [],
  listUnitPrice: null,
  vatNature: null,
  vatNatureLabel: null,
  ...over,
});

export const xmlLine = (over: Partial<ReviewLine> = {}, xml: Partial<ReviewLineXml> = {}) =>
  makeLine({ xml: lineXml(xml), rawDescription: "Mozzarella Demo", ...over });

export const PARTNER_ID = "1b000000-0000-4000-8000-0000000000c1";

export const partner = (over: Partial<DuplicatePartner> = {}): DuplicatePartner => ({
  id: PARTNER_ID,
  number: "FT 12",
  date: "1998-11-03",
  grossTotal: 1234.5,
  format: "document",
  status: "review",
  amountsMatch: true,
  ...over,
});

/** An XML invoice in review: the XML columns, the file's VAT summary and (optionally) lines. */
export function makeXmlReview(
  lines: ReviewLine[] = [xmlLine()],
  over: Partial<InvoiceReview> = {},
  xml: Partial<ReviewInvoiceXml> = {},
  invoice: Partial<InvoiceReview["invoice"]> = {},
): InvoiceReview {
  const base = makeReview(lines, {
    vatSummary: [
      { rate: 22, nature: null, natureLabel: null, taxable: 100, tax: 22 },
      { rate: 0, nature: "N4", natureLabel: "Esenti", taxable: 10, tax: 0 },
    ],
    ...over,
  });
  return {
    ...base,
    invoice: {
      ...base.invoice,
      originalFilename: "FT12.xml",
      fileMime: "application/xml",
      number: "FT 12",
      invoiceDate: "1998-11-03",
      dueDate: "1998-12-03",
      grossTotal: 132,
      xml: xmlInfo(xml),
      ...invoice,
    },
  };
}
