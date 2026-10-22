import { z } from "zod";
import type { InvoiceExtraction } from "@/server/extraction/schema";

// Compares a live extraction with the hand-checked `<name>.expected.json` and summarises the run
// (AT8). Rules: strings trim + case-fold, amounts to the cent, dates exact. The summary carries
// field names and milliseconds only: never a value from an invoice.

/** AT8: each model call must finish within this. */
export const MAX_MODEL_CALL_MS = 60_000;

const text = z.string().nullable();
const amount = z.number().nullable();
const date = z.iso.date().nullable();

const expectedLine = z.strictObject({
  description: text.optional(),
  supplier_code: text.optional(),
  qty: amount.optional(),
  unit: text.optional(),
  unit_price: amount.optional(),
  line_amount: amount.optional(),
  vat_rate: amount.optional(),
  lot_code: text.optional(),
  expiry: date.optional(),
});

const expectedInvoice = z.strictObject({
  supplier_name: text.optional(),
  supplier_vat: text.optional(),
  invoice_number: text.optional(),
  invoice_date: date.optional(),
  due_date: date.optional(),
  payment_terms: text.optional(),
  net_total: amount.optional(),
  vat_total: amount.optional(),
  gross_total: amount.optional(),
  lines: z.array(expectedLine).optional(),
});
export type ExpectedInvoice = z.infer<typeof expectedInvoice>;

export function parseExpected(value: unknown): ExpectedInvoice {
  return expectedInvoice.parse(value);
}

type Kind = "text" | "money" | "quantity" | "date";
const HEADER_KINDS: Record<string, Kind> = {
  supplier_name: "text",
  supplier_vat: "text",
  invoice_number: "text",
  invoice_date: "date",
  due_date: "date",
  payment_terms: "text",
  net_total: "money",
  vat_total: "money",
  gross_total: "money",
};
const LINE_KINDS: Record<string, Kind> = {
  description: "text",
  supplier_code: "text",
  qty: "quantity",
  unit: "text",
  unit_price: "money",
  line_amount: "money",
  vat_rate: "quantity",
  lot_code: "text",
  expiry: "date",
};

const CENT = 100;
const QUANTITY_SCALE = 10_000;

function same(kind: Kind, expected: unknown, actual: unknown): boolean {
  if (expected === null || actual === null || actual === undefined) return expected === actual;
  switch (kind) {
    case "text":
      return fold(String(expected)) === fold(String(actual));
    case "money":
      return Math.round(Number(expected) * CENT) === Math.round(Number(actual) * CENT);
    case "quantity":
      return (
        Math.round(Number(expected) * QUANTITY_SCALE) ===
        Math.round(Number(actual) * QUANTITY_SCALE)
      );
    case "date":
      return expected === actual;
  }
}
const fold = (value: string) => value.normalize("NFC").trim().toLowerCase();

export interface FieldResult {
  field: string;
  match: boolean;
}

/** One result per field the expected file mentions; fields it leaves out are not compared. */
export function compareInvoice(
  expected: ExpectedInvoice,
  actual: InvoiceExtraction,
): FieldResult[] {
  const results: FieldResult[] = [];
  for (const [field, kind] of Object.entries(HEADER_KINDS)) {
    const want = (expected as Record<string, unknown>)[field];
    if (want === undefined) continue;
    results.push({ field, match: same(kind, want, (actual as Record<string, unknown>)[field]) });
  }
  if (expected.lines) {
    results.push({ field: "lines.count", match: expected.lines.length === actual.lines.length });
    expected.lines.forEach((wantLine, index) => {
      const gotLine = actual.lines[index] as Record<string, unknown> | undefined;
      for (const [field, kind] of Object.entries(LINE_KINDS)) {
        const want = (wantLine as Record<string, unknown>)[field];
        if (want === undefined) continue;
        results.push({
          field: `lines.${field}`,
          match: gotLine !== undefined && same(kind, want, gotLine[field]),
        });
      }
    });
  }
  return results;
}

/**
 * How many expected lines would need a correction in the review screen: a line counts as soon as
 * one field the expected file mentions differs, or the line is missing. This is the live proxy
 * for the extraction side of M4 AT5 (the review's "corrected line" is any value the reading got
 * wrong). Lines with nothing to compare are left out; extra lines the model invented are not
 * counted (the `lines.count` field shows those).
 */
export function lineCorrections(
  expected: ExpectedInvoice,
  actual: InvoiceExtraction,
): { total: number; needing: number } {
  let total = 0;
  let needing = 0;
  (expected.lines ?? []).forEach((wantLine, index) => {
    const gotLine = actual.lines[index] as Record<string, unknown> | undefined;
    const compared = Object.entries(LINE_KINDS).filter(
      ([field]) => (wantLine as Record<string, unknown>)[field] !== undefined,
    );
    if (compared.length === 0) return;
    total += 1;
    const wrong =
      gotLine === undefined ||
      compared.some(
        ([field, kind]) =>
          !same(kind, (wantLine as Record<string, unknown>)[field], gotLine[field]),
      );
    if (wrong) needing += 1;
  });
  return { total, needing };
}

export interface InvoiceResult {
  name: string;
  /** False when the call failed or the answer did not pass the schema. */
  ok: boolean;
  durationMs: number;
  fields: FieldResult[];
  /** From `lineCorrections`; absent when the expected file has no lines. */
  lines?: { total: number; needing: number };
}

export interface Summary {
  fields: { field: string; total: number; matched: number; accuracyPct: number }[];
  invoices: { name: string; ok: boolean; durationMs: number }[];
  /** Expected lines compared, over invoices that passed the schema. */
  linesTotal: number;
  linesNeedingCorrection: number;
  /** Share of compared lines that matched on every field, to one decimal; null with no lines. */
  linesUncorrectedPct: number | null;
  passed: boolean;
  problems: string[];
}

export function summarise(results: readonly InvoiceResult[]): Summary {
  const counts = new Map<string, { total: number; matched: number }>();
  const problems: string[] = [];
  let linesTotal = 0;
  let linesNeeding = 0;
  for (const result of results) {
    if (!result.ok) problems.push(`${result.name}: extraction failed`);
    if (result.durationMs >= MAX_MODEL_CALL_MS) {
      problems.push(
        `${result.name}: model call took ${result.durationMs} ms (limit ${MAX_MODEL_CALL_MS} ms)`,
      );
    }
    if (!result.ok) continue;
    linesTotal += result.lines?.total ?? 0;
    linesNeeding += result.lines?.needing ?? 0;
    for (const { field, match } of result.fields) {
      const count = counts.get(field) ?? { total: 0, matched: 0 };
      count.total += 1;
      if (match) count.matched += 1;
      counts.set(field, count);
    }
  }
  return {
    fields: [...counts].map(([field, { total, matched }]) => ({
      field,
      total,
      matched,
      accuracyPct: Math.round((matched / total) * 1000) / 10,
    })),
    invoices: results.map(({ name, ok, durationMs }) => ({ name, ok, durationMs })),
    linesTotal,
    linesNeedingCorrection: linesNeeding,
    linesUncorrectedPct:
      linesTotal === 0 ? null : Math.round(((linesTotal - linesNeeding) / linesTotal) * 1000) / 10,
    passed: problems.length === 0,
    problems,
  };
}

/** Markdown for $GITHUB_STEP_SUMMARY: field names, counts and milliseconds. No invoice values. */
export function renderSummary(summary: Summary): string {
  const lines = [
    "## Extraction contract",
    "",
    `Esito: ${summary.passed ? "superato" : "non superato"}`,
    "",
    "| Field | Matched | Accuracy |",
    "|---|---|---|",
    ...summary.fields.map((f) => `| ${f.field} | ${f.matched}/${f.total} | ${f.accuracyPct}% |`),
    ...(summary.linesUncorrectedPct === null
      ? []
      : [
          `| Lines needing no correction | ${summary.linesTotal - summary.linesNeedingCorrection}/${summary.linesTotal} | ${summary.linesUncorrectedPct}% |`,
        ]),
    "",
    "| Invoice | Schema | Model call |",
    "|---|---|---|",
    ...summary.invoices.map((i) => `| ${i.name} | ${i.ok ? "yes" : "no"} | ${i.durationMs} ms |`),
  ];
  if (summary.problems.length > 0) lines.push("", ...summary.problems.map((p) => `- ${p}`));
  lines.push("", "Queue wait is not included in the model call time.");
  return lines.join("\n");
}
