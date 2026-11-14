/**
 * The XML side of the review reply (P2-7): what the file held, the wording of its notes, the amount comparison of a
 * look-alike pair. Pure; the screens only render what comes out. Wording is a draft, "da approvare".
 */
import { z } from "zod";
import { reportError } from "@/lib/observability/report";
import { documentTypeLabel, natureLabel } from "@/server/fatturapa/labels";
import type { ReviewInvoiceXml, ReviewLineXml, ReviewVatRow } from "@/server/invoices/review-types";

const NOTE_LABELS: Record<string, string> = {
  attachments: "Allegati nel file (non importati)",
  ddt_refs: "Riferimenti a DDT (non importati)",
  order_refs: "Riferimenti a ordini o contratti (non importati)",
  text_lines_skipped: "Righe descrittive senza importo (non importate)",
  rounding_line_added: "Arrotondamento aggiunto come riga",
  riepilogo_negative_residual:
    "Il riepilogo IVA è inferiore alla somma delle righe: controlla il totale",
  document_discount: "Sconto sul totale documento: controlla il totale",
  stamp_duty: "Bollo indicato nel file (non importato)",
  instalments: "Pagamento a rate: scadenza della prima rata",
  buyer_unchecked: "Partita IVA del locale non impostata: intestatario non controllato",
  vehicle_data: "Dati di veicoli nel file (non importati)",
};

/** The columns the review reads from `invoice` for the XML side. Absent on rows read before P2-7 (tests), which are documents. */
export interface InvoiceXmlColumns {
  file_mime: string;
  document_type?: string | null;
  xml_format?: string | null;
  xml_body_index?: number | null;
  xml_body_count?: number | null;
  xml_notes?: string[] | null;
}

export const isXmlInvoice = (row: Pick<InvoiceXmlColumns, "document_type">): boolean =>
  row.document_type !== null && row.document_type !== undefined;

export function buildInvoiceXml(row: InvoiceXmlColumns): ReviewInvoiceXml | null {
  if (!isXmlInvoice(row)) return null;
  return {
    format: row.xml_format as ReviewInvoiceXml["format"],
    documentType: row.document_type!,
    documentTypeLabel: documentTypeLabel(row.document_type!),
    signed: row.file_mime === "application/pkcs7-mime",
    bodyIndex: Number(row.xml_body_index),
    bodyCount: Number(row.xml_body_count),
    notes: (row.xml_notes ?? []).map((code) => ({
      code,
      label: Object.hasOwn(NOTE_LABELS, code) ? NOTE_LABELS[code]! : code,
    })),
  };
}

export interface VatSummaryRow {
  position: number;
  vat_rate: number | string;
  vat_nature: string | null;
  taxable: number | string;
  tax: number | string;
}

export function buildVatSummary(rows: readonly VatSummaryRow[] | undefined): ReviewVatRow[] {
  return [...(rows ?? [])]
    .sort((a, b) => a.position - b.position)
    .map((row) => ({
      rate: Number(row.vat_rate),
      nature: row.vat_nature,
      natureLabel: row.vat_nature ? natureLabel(row.vat_nature) : null,
      taxable: Number(row.taxable),
      tax: Number(row.tax),
    }));
}

// The shape import_xml_invoices stores (map.ts writes it). An owner can call that procedure with any object, so the reply
// checks it instead of trusting it.
const decimal = z.string().regex(/^-?[0-9]{1,18}(\.[0-9]{1,8})?$/);
const detailsSchema = z.object({
  lineNumber: z.number().int().nullable(),
  kind: z.enum(["SC", "PR", "AB", "AC", "residual"]).nullable(),
  codes: z.array(z.object({ type: z.string(), value: z.string() })),
  otherData: z.array(
    z.object({
      type: z.string(),
      text: z.string().nullable(),
      number: decimal.nullable(),
      date: z.string().nullable(),
    }),
  ),
  discounts: z.array(
    z.object({ type: z.string(), percent: decimal.nullable(), amount: decimal.nullable() }),
  ),
  listUnitPrice: decimal.nullable(),
});

const numberOrNull = (value: string | null): number | null =>
  value === null ? null : Number(value);

/** The file's data for one line. A shape the importer never writes is reported (line id only) and shown as no data. */
export function buildLineXml(
  lineId: string,
  details: unknown,
  vatNature: string | null | undefined,
): ReviewLineXml | null {
  if (details === null || details === undefined) return null;
  const parsed = detailsSchema.safeParse(details);
  if (!parsed.success) {
    reportError(new Error(`Invoice line ${lineId} has xml_details of an unexpected shape`));
    return null;
  }
  const data = parsed.data;
  return {
    lineNumber: data.lineNumber,
    kind: data.kind,
    codes: data.codes,
    otherData: data.otherData.map((item) => ({ ...item, number: numberOrNull(item.number) })),
    discounts: data.discounts.map((item) => ({
      type: item.type,
      percent: numberOrNull(item.percent),
      amount: numberOrNull(item.amount),
    })),
    listUnitPrice: numberOrNull(data.listUnitPrice),
    vatNature: vatNature ?? null,
    vatNatureLabel: vatNature ? natureLabel(vatNature) : null,
  };
}

/** The two gross totals differ by at most 0,05 euro (whole ten-thousandths, never floats); null when one is missing. */
export function amountsMatch(a: number | null, b: number | null): boolean | null {
  if (a === null || b === null) return null;
  return Math.abs(Math.round(a * 1e4) - Math.round(b * 1e4)) <= 500;
}
