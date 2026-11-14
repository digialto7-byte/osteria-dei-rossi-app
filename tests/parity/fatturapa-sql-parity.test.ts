import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { z } from "zod";
import {
  XML_DOCUMENT_TYPES,
  XML_MAX_BODIES,
  XML_MAX_LINES,
  XML_NATURES,
  XML_NOTES,
} from "@/server/fatturapa/constants";
import { XmlImportPayload } from "@/server/fatturapa/schema";

const read = (name: string) =>
  readFileSync(new URL(`../../supabase/migrations/${name}`, import.meta.url), "utf8");
const IMPORT = read("20261204100300_import_xml_invoices.sql");
const COLUMNS = read("20261204100000_xml_invoice_columns.sql");

/** The quoted words of `array['a', 'b']` inside `create function app.<name>`. */
function sqlList(sql: string, fn: string): string[] {
  const match = new RegExp(
    `create function app\\.${fn}\\(\\)[^$]*\\$\\$\\s*select array\\[([^\\]]*)\\]`,
  ).exec(sql);
  expect(match, `list ${fn}`).not.toBeNull();
  return [...match![1]!.matchAll(/'([^']+)'/g)].map((m) => m[1]!);
}

const sqlInt = (fn: string): number => {
  const match = new RegExp(
    `create function app\\.${fn}\\(\\)[^$]*\\$\\$ select ([0-9]+) \\$\\$`,
  ).exec(IMPORT);
  expect(match, `constant ${fn}`).not.toBeNull();
  return Number(match![1]);
};

describe("the TypeScript constants equal the SQL ones", () => {
  it("bodies and lines", () => {
    expect(XML_MAX_BODIES).toBe(sqlInt("xml_max_bodies"));
    expect(XML_MAX_LINES).toBe(sqlInt("xml_max_lines"));
  });

  it("the document-type allow-list, the notes and the natures", () => {
    expect([...XML_DOCUMENT_TYPES]).toEqual(sqlList(IMPORT, "xml_document_types"));
    expect([...XML_NOTES]).toEqual(sqlList(IMPORT, "xml_notes_allowed"));
    expect([...XML_NATURES]).toEqual(sqlList(IMPORT, "xml_natures"));
  });

  it("the column constraints of the first migration list the same values", () => {
    for (const value of [...XML_DOCUMENT_TYPES, ...XML_NOTES, ...XML_NATURES])
      expect(COLUMNS).toContain(`'${value}'`);
  });
});

type Payload = z.input<typeof XmlImportPayload>;
const goodPayload = (): Payload => ({
  sha256: "a".repeat(64),
  format: "FPR12",
  bodyCount: 1,
  buyer: { vat: "IT00000000000", cf: null },
  invoices: [
    {
      id: "0b8e6d0e-6a1b-4a38-9d7c-5f3a1f2a9c11",
      filePath:
        "7c1f2a3b-0000-4000-8000-000000000001/1998/0b8e6d0e-6a1b-4a38-9d7c-5f3a1f2a9c11.xml",
      fileMime: "application/xml",
      fileSizeBytes: 1000,
      originalFilename: null,
      bodyIndex: 1,
      documentType: "TD01",
      notes: [],
      header: {
        supplierVat: "IT12345678903",
        supplierName: "Fornitore Demo 1",
        numberRaw: "FT 12",
        invoiceDate: "1998-11-03",
        dueDate: null,
        netTotal: "10.00",
        vatTotal: "2.20",
        grossTotal: "12.20",
      },
      lines: [
        {
          rawDescription: "x",
          supplierCode: null,
          qty: "1.0000",
          unitRaw: null,
          unitPrice: "10.0000",
          lineAmount: "10.0000",
          vatRate: "22.00",
          vatNature: null,
          xmlDetails: { lineNumber: 1 },
        },
      ],
      vatSummary: [
        {
          vatRate: "22.00",
          vatNature: null,
          taxable: "10.00",
          tax: "2.20",
          rounding: null,
          accessoryCosts: null,
          vatChargeability: null,
          legalReference: null,
        },
      ],
    },
  ],
});

describe("XmlImportPayload mirrors the SQL shape checks", () => {
  it("accepts a good payload", () => {
    expect(XmlImportPayload.safeParse(goodPayload()).success).toBe(true);
  });

  const mutate = (fn: (p: ReturnType<typeof goodPayload>) => void): boolean => {
    const payload = goodPayload();
    fn(payload);
    return XmlImportPayload.safeParse(payload).success;
  };

  it("refuses an unknown key at every level", () => {
    expect(mutate((p) => Object.assign(p, { extra: 1 }))).toBe(false);
    expect(mutate((p) => Object.assign(p.buyer, { extra: 1 }))).toBe(false);
    expect(mutate((p) => Object.assign(p.invoices[0]!, { extra: 1 }))).toBe(false);
    expect(mutate((p) => Object.assign(p.invoices[0]!.header, { extra: 1 }))).toBe(false);
    expect(mutate((p) => Object.assign(p.invoices[0]!.lines[0]!, { extra: 1 }))).toBe(false);
    expect(mutate((p) => Object.assign(p.invoices[0]!.vatSummary[0]!, { extra: 1 }))).toBe(false);
  });

  it("refuses amounts that are not plain decimal strings", () => {
    for (const bad of ["1e3", "10.00001", "-1.00", "123456789.00", " 1", "1,5"]) {
      expect(
        mutate((p) => (p.invoices[0]!.header.netTotal = bad)),
        bad,
      ).toBe(false);
    }
    expect(mutate((p) => (p.invoices[0]!.header.netTotal = 10 as unknown as string))).toBe(false);
    expect(mutate((p) => (p.invoices[0]!.vatSummary[0]!.rounding = "-0.40"))).toBe(true);
    expect(mutate((p) => (p.invoices[0]!.lines[0]!.lineAmount = "-0.40"))).toBe(false);
  });

  it("refuses a count, an order, a type, a note or a nature the SQL would refuse", () => {
    expect(mutate((p) => (p.bodyCount = 2))).toBe(false);
    expect(mutate((p) => (p.invoices[0]!.bodyIndex = 2))).toBe(false);
    expect(mutate((p) => (p.invoices[0]!.documentType = "TD04" as never))).toBe(false);
    expect(mutate((p) => (p.invoices[0]!.notes = ["nope" as never]))).toBe(false);
    expect(mutate((p) => (p.invoices[0]!.lines[0]!.vatNature = "N2" as never))).toBe(false);
    expect(mutate((p) => (p.invoices[0]!.vatSummary = []))).toBe(false);
    expect(mutate((p) => (p.invoices = []))).toBe(false);
    expect(mutate((p) => (p.format = "FPX12" as never))).toBe(false);
  });

  it("refuses a path that does not fit the id and the type", () => {
    expect(
      mutate((p) => (p.invoices[0]!.filePath = p.invoices[0]!.filePath.replace(".xml", ".p7m"))),
    ).toBe(false);
    expect(mutate((p) => (p.invoices[0]!.filePath = "../x/1998/a.xml"))).toBe(false);
  });
});
