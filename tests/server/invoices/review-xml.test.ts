import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildReview,
  loadInvoiceReview,
  type PartnerRow,
  type ReviewInvoiceRow,
  type ReviewLineRow,
  type ReviewSource,
} from "@/server/invoices/review";
import { XML_NOTES } from "@/server/fatturapa/constants";
import {
  INVOICE_ID,
  INVOICE_ROW,
  LINE_ROW,
  PARTNER_ID,
  ok,
  previewRpc,
  reviewClient,
} from "../../helpers/review-data";

const reportError = vi.fn();
vi.mock("@/lib/observability/report", () => ({ reportError: (e: unknown) => reportError(e) }));

// P2-7 S14 (plan 3.7): the review reply says what the XML file held, so the screen only renders it. Fake data only.

const SUPPLIER_ID = "5a000000-0000-4000-8000-000000000001";
const ING = "1d000000-0000-4000-8000-000000000001";
const lineId = (n: number) => `11000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const xmlInvoice = (over: Partial<ReviewInvoiceRow> = {}): ReviewInvoiceRow => ({
  ...(INVOICE_ROW as unknown as ReviewInvoiceRow),
  original_filename: "IT01234567890_00001.xml",
  file_mime: "application/xml",
  number_raw: "FT 12",
  invoice_date: "1998-11-03",
  gross_total: 100,
  document_type: "TD01",
  xml_format: "FPR12",
  xml_body_index: 1,
  xml_body_count: 1,
  xml_notes: [],
  ...over,
});

const DETAILS = {
  lineNumber: 1,
  kind: "SC",
  codes: [
    { type: "EAN", value: "8000000000001" },
    { type: "INT", value: "A-1" },
  ],
  otherData: [
    { type: "LOTTO", text: "L-DEMO-0001", number: null, date: null },
    { type: "SCADENZA", text: null, number: null, date: "1998-12-01" },
    { type: "PESO", text: null, number: "1.5000", date: null },
  ],
  discounts: [{ type: "SC", percent: "10.00", amount: null }],
  listUnitPrice: "10.0000",
  periodStart: null,
  periodEnd: null,
};

const line = (n: number, over: Partial<ReviewLineRow> = {}): ReviewLineRow => ({
  ...(LINE_ROW as unknown as ReviewLineRow),
  id: lineId(n),
  position: n,
  ingredient_id: ING,
  xml_details: DETAILS,
  vat_nature: null,
  ...over,
});

const source = (over: Partial<ReviewSource> = {}): ReviewSource => ({
  invoice: xmlInvoice(),
  suppliers: [{ id: SUPPLIER_ID, name: "Fornitore Demo 1", vat_number: "IT12345678903" }],
  lines: [line(1)],
  ingredients: [{ id: ING, name: "Fesa di manzo", base_unit: "kg" }],
  items: [],
  costCentres: [],
  vatSummary: [
    { position: 1, vat_rate: "22.00", vat_nature: null, taxable: "100.00", tax: "22.00" },
    { position: 2, vat_rate: "0.00", vat_nature: "N4", taxable: "10.00", tax: "0.00" },
  ],
  ...over,
});

beforeEach(() => reportError.mockReset());

describe("invoice.xml", () => {
  it("names the format, the type with its label, the body and the notes with their labels", () => {
    const review = buildReview(
      source({
        invoice: xmlInvoice({
          xml_body_index: 2,
          xml_body_count: 3,
          xml_notes: ["attachments", "rounding_line_added"],
        }),
      }),
    );
    expect(review.invoice.xml).toEqual({
      format: "FPR12",
      documentType: "TD01",
      documentTypeLabel: "Fattura",
      signed: false,
      bodyIndex: 2,
      bodyCount: 3,
      notes: [
        { code: "attachments", label: expect.stringMatching(/allegat/i) },
        { code: "rounding_line_added", label: expect.stringMatching(/arrotondamento/i) },
      ],
    });
  });

  it("says a p7m is signed, and labels the deferred types", () => {
    const xml = buildReview(
      source({
        invoice: xmlInvoice({ file_mime: "application/pkcs7-mime", document_type: "TD24" }),
      }),
    ).invoice.xml;
    expect([xml?.signed, xml?.documentTypeLabel]).toEqual([
      true,
      "Fattura differita (art. 21 c. 4 lett. a)",
    ]);
  });

  it("has a label for every note the database allows", () => {
    const review = buildReview(source({ invoice: xmlInvoice({ xml_notes: [...XML_NOTES] }) }));
    expect(review.invoice.xml!.notes.map((n) => n.code)).toEqual([...XML_NOTES]);
    for (const note of review.invoice.xml!.notes) expect(note.label.length).toBeGreaterThan(5);
  });

  it("is null, with no summary and no line data, for a photo or PDF", () => {
    const review = buildReview(
      source({
        invoice: xmlInvoice({
          document_type: null,
          xml_format: null,
          xml_body_index: null,
          xml_body_count: null,
          xml_notes: [],
          file_mime: "application/pdf",
        }),
        lines: [line(1, { xml_details: null })],
        vatSummary: [],
      }),
    );
    expect(review.invoice.xml).toBeNull();
    expect(review.vatSummary).toEqual([]);
    expect(review.lines[0]!.xml).toBeNull();
    expect(review.replaceWithXml).toBeNull();
  });
});

describe("vatSummary", () => {
  it("gives rate, nature with its label, taxable and tax, in the file's order", () => {
    expect(buildReview(source()).vatSummary).toEqual([
      { rate: 22, nature: null, natureLabel: null, taxable: 100, tax: 22 },
      { rate: 0, nature: "N4", natureLabel: "Esenti", taxable: 10, tax: 0 },
    ]);
  });

  it("puts the rows in position order even when the database returns them otherwise", () => {
    const reversed = [...source().vatSummary!].reverse();
    expect(buildReview(source({ vatSummary: reversed })).vatSummary.map((r) => r.rate)).toEqual([
      22, 0,
    ]);
  });
});

describe("lines[].xml", () => {
  it("shows the file number, kind, codes, other data, discounts and list price as numbers where they are amounts", () => {
    const xml = buildReview(source()).lines[0]!.xml;
    expect(xml).toEqual({
      lineNumber: 1,
      kind: "SC",
      codes: [
        { type: "EAN", value: "8000000000001" },
        { type: "INT", value: "A-1" },
      ],
      otherData: [
        { type: "LOTTO", text: "L-DEMO-0001", number: null, date: null },
        { type: "SCADENZA", text: null, number: null, date: "1998-12-01" },
        { type: "PESO", text: null, number: 1.5, date: null },
      ],
      discounts: [{ type: "SC", percent: 10, amount: null }],
      listUnitPrice: 10,
      vatNature: null,
      vatNatureLabel: null,
    });
  });

  it("carries the VAT nature of an exempt line with its label", () => {
    const xml = buildReview(source({ lines: [line(1, { vat_rate: 0, vat_nature: "N4" })] }))
      .lines[0]!.xml;
    expect([xml?.vatNature, xml?.vatNatureLabel]).toEqual(["N4", "Esenti"]);
  });

  it("is null for a line without xml_details (a part of a split, a line added by hand)", () => {
    expect(
      buildReview(source({ lines: [line(1, { xml_details: null })] })).lines[0]!.xml,
    ).toBeNull();
    expect(reportError).not.toHaveBeenCalled();
  });

  it("reports a line whose xml_details has an unexpected shape, by line id only, and shows no data for it", () => {
    const review = buildReview(
      source({ lines: [line(1, { xml_details: { codes: "SECRET-CODE" } as never })] }),
    );
    expect(review.lines[0]!.xml).toBeNull();
    expect(reportError).toHaveBeenCalledOnce();
    const message = String((reportError.mock.calls[0]![0] as Error).message);
    expect(message).toContain(lineId(1));
    expect(message).not.toContain("SECRET");
  });

  it("keeps P2-2's lotMissing for a stock line of an XML invoice", () => {
    const review = buildReview(source());
    expect(review.lines[0]!.lotMissing).toBe(true);
    expect(review.summary.stockLinesWithoutLot).toBe(1);
  });
});

const PARTNER_PDF: PartnerRow = {
  id: PARTNER_ID,
  number_raw: "FT 12",
  invoice_date: "1998-11-03",
  status: "review",
  gross_total: 100,
  document_type: null,
};
const withPartner = (
  invoice: Partial<ReviewInvoiceRow>,
  partner: Partial<PartnerRow> | null,
  over: Partial<ReviewSource> = {},
): ReturnType<typeof buildReview> =>
  buildReview(
    source({
      invoice: xmlInvoice({ status: "duplicate", duplicate_of: PARTNER_ID, ...invoice }),
      partner: partner === null ? null : { ...PARTNER_PDF, ...partner },
      preview: {
        status: "duplicate",
        blockers: [{ code: "duplicate_invoice", lineIds: [], partnerId: PARTNER_ID }],
        receiptDate: null,
        payable: {
          grossAmount: null,
          creditedAmount: null,
          amount: null,
          dueDate: null,
          dueDateSource: null,
        },
        receipts: 0,
        lines: [],
        locations: { required: false, options: [], defaultId: null },
      },
      ...over,
    }),
  );

describe("duplicatePartner and the amount comparison", () => {
  it.each([
    [100.0, true],
    [100.04, true],
    [100.05, true],
    [100.06, false],
    [99.94, false],
    [99.95, true],
  ])("a partner total of %s against 100,00: amountsMatch %s", (gross, expected) => {
    expect(withPartner({}, { gross_total: gross }).duplicatePartner?.amountsMatch).toBe(expected);
  });

  it("is null when a total is missing, and says what the partner is", () => {
    expect(withPartner({}, { gross_total: null }).duplicatePartner).toMatchObject({
      grossTotal: null,
      amountsMatch: null,
    });
    expect(withPartner({ gross_total: null }, {}).duplicatePartner?.amountsMatch).toBeNull();
    expect(withPartner({}, {}).duplicatePartner).toEqual({
      id: PARTNER_ID,
      number: "FT 12",
      date: "1998-11-03",
      grossTotal: 100,
      format: "document",
      status: "review",
      amountsMatch: true,
    });
    expect(withPartner({}, { document_type: "TD01" }).duplicatePartner?.format).toBe("xml");
  });
});

describe("replaceWithXml", () => {
  it("is set for an XML duplicate of a photo or PDF still in review", () => {
    expect(withPartner({}, {}).replaceWithXml).toEqual({ partnerId: PARTNER_ID });
  });

  it.each([
    ["the photo is approved", {}, { status: "approved" }],
    ["the photo is rejected", {}, { status: "rejected" }],
    ["the partner is an XML file too", {}, { document_type: "TD01" }],
    ["the XML invoice is in review", { status: "review" as const }, {}],
    [
      "this invoice is a photo or PDF",
      {
        document_type: null,
        xml_format: null,
        xml_body_index: null,
        xml_body_count: null,
        xml_notes: [],
      },
      {},
    ],
  ])("is null when %s", (_name, invoice, partner) => {
    expect(withPartner(invoice, partner).replaceWithXml).toBeNull();
  });

  it("is null when the partner cannot be read", () => {
    expect(withPartner({}, null).replaceWithXml).toBeNull();
  });
});

const TABLES = (over: Record<string, ReturnType<typeof ok>[]> = {}) => ({
  invoice: [ok(xmlInvoice())],
  invoice_line: [ok([line(1)])],
  invoice_vat_summary: [ok(source().vatSummary)],
  ...over,
});
const load = (client: ReturnType<typeof reviewClient>) =>
  loadInvoiceReview(client as unknown as SupabaseClient, INVOICE_ID);

describe("loadInvoiceReview for an XML invoice", () => {
  it("reads the VAT summary in position order with an explicit column list, and the XML columns of the invoice and the line", async () => {
    const client = reviewClient("owner", { tables: TABLES(), rpc: previewRpc() });
    const review = await load(client);
    expect(review.vatSummary).toHaveLength(2);
    const reads = client.from.mock.calls.map(([table]) => table as string);
    expect(reads).toContain("invoice_vat_summary");
    const selects = client.query.select.mock.calls.map(([columns]) => columns as string);
    expect(selects).toContain("position, vat_rate, vat_nature, taxable, tax");
    expect(selects.find((c) => c.startsWith("id, status, source"))).toMatch(
      /document_type, xml_format, xml_body_index, xml_body_count, xml_notes/,
    );
    expect(selects.find((c) => c.startsWith("id, position, sub_position"))).toMatch(
      /vat_nature, xml_details/,
    );
    expect(client.query.order).toHaveBeenCalledWith("position");
  });

  it("does not read the VAT summary for a photo or PDF", async () => {
    const client = reviewClient("owner", { rpc: previewRpc() });
    await load(client);
    expect(client.from.mock.calls.map(([table]) => table)).not.toContain("invoice_vat_summary");
  });

  it("reads the partner's status, total and kind with its number and date", async () => {
    const client = reviewClient("owner", {
      tables: TABLES({ invoice: [ok(xmlInvoice({ status: "duplicate" })), ok(PARTNER_PDF)] }),
      rpc: previewRpc({
        status: "duplicate",
        blockers: [{ code: "duplicate_invoice", lineIds: [], partnerId: PARTNER_ID }],
        receiptDate: null,
        payable: {
          grossAmount: null,
          creditedAmount: null,
          amount: null,
          dueDate: null,
          dueDateSource: null,
        },
        receipts: 0,
        lines: [],
        locations: { required: false, options: [], defaultId: null },
      }),
    });
    const review = await load(client);
    expect(client.query.select).toHaveBeenCalledWith(
      "id, number_raw, invoice_date, status, gross_total, document_type",
    );
    expect(review.replaceWithXml).toEqual({ partnerId: PARTNER_ID });
  });
});
