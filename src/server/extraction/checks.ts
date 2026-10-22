import { isValidItVat, normaliseItVat } from "@/lib/vat/it-vat";
import {
  ALLOWED_VAT_RATES,
  FAILED_CHECK_CONFIDENCE,
  LINE_AMOUNT_TOLERANCE_TEN_THOUSANDTHS,
  LOW_CONFIDENCE_THRESHOLD,
  TOTAL_TOLERANCE_TEN_THOUSANDTHS,
} from "@/server/extraction/constants";
import type { ExtractedLine, InvoiceExtraction } from "@/server/extraction/schema";
import { CONTROL_OR_BIDI } from "@/server/invoices/file-check";

export type GateFlag = "total_mismatch" | "low_confidence";
export type LineCheck = "amount_mismatch" | "vat_rate_unexpected";

export interface CheckedExtraction {
  /** Normalised data, with the confidence of failed fields capped. */
  data: InvoiceExtraction;
  /** Per line, in order. */
  lineChecks: LineCheck[][];
  gateFlags: GateFlag[];
  /** Σ line_amount + vat_total − gross_total in euros, or null when a total is missing. */
  totalsDiff: number | null;
}

const UNREADABLE = "(illeggibile)";
// Column form, plus at least one digit so that a stray word is not taken for a VAT number.
const FOREIGN_VAT = /^(?=.*[0-9])[A-Z]{2}[0-9A-Z]{2,12}$/;

// Money is compared as whole ten-thousandths of a euro, never as floats.
const units = (value: number) => Math.round(value * 1e4);

function clean(value: string): string {
  return value
    .normalize("NFC")
    .replace(/[\t\n\r]/g, " ")
    .replace(CONTROL_OR_BIDI, "")
    .trim();
}

const cleanOrNull = (value: string | null): string | null => {
  if (value === null) return null;
  const cleaned = clean(value);
  return cleaned === "" ? null : cleaned;
};

/** A valid VAT number in column form, or null. */
function normaliseVat(raw: string): string | null {
  const vat = normaliseItVat(raw.replace(/[.\s-]/g, ""));
  if (vat.startsWith("IT")) return isValidItVat(vat) ? vat : null;
  return FOREIGN_VAT.test(vat) ? vat : null;
}

/** Σ line_amount + vat_total − gross_total against the tolerance (PRD 1.2). */
export function totalsGate(
  lines: readonly { line_amount: number }[],
  vatTotal: number | null,
  grossTotal: number | null,
): { flagged: boolean; diff: number | null } {
  if (vatTotal === null || grossTotal === null) return { flagged: true, diff: null };
  const sum = lines.reduce((total, line) => total + units(line.line_amount), 0);
  const diffUnits = sum + units(vatTotal) - units(grossTotal);
  return {
    flagged: Math.abs(diffUnits) > TOTAL_TOLERANCE_TEN_THOUSANDTHS,
    diff: diffUnits / 1e4 || 0,
  };
}

const cap = (confidence: number) => Math.min(confidence, FAILED_CHECK_CONFIDENCE);

function checkLine(line: ExtractedLine): { line: ExtractedLine; checks: LineCheck[] } {
  const confidence = { ...line.confidence };
  const checks: LineCheck[] = [];
  if (
    line.unit_price !== null &&
    Math.abs(units(line.qty * line.unit_price) - units(line.line_amount)) >
      LINE_AMOUNT_TOLERANCE_TEN_THOUSANDTHS
  ) {
    checks.push("amount_mismatch");
    confidence.line_amount = cap(confidence.line_amount);
  }
  if (line.vat_rate !== null && !(ALLOWED_VAT_RATES as readonly number[]).includes(line.vat_rate)) {
    checks.push("vat_rate_unexpected");
    confidence.vat_rate = cap(confidence.vat_rate);
  }
  return { line: { ...line, confidence }, checks };
}

function normaliseLine(line: ExtractedLine): ExtractedLine {
  const confidence = { ...line.confidence };
  let description = clean(line.description);
  if (description === "") {
    description = UNREADABLE;
    confidence.description = cap(confidence.description);
  }
  return {
    ...line,
    description,
    supplier_code: cleanOrNull(line.supplier_code),
    unit: cleanOrNull(line.unit),
    lot_code: cleanOrNull(line.lot_code),
    confidence,
  };
}

/** Normalises strings and the VAT number, runs the per-line checks and the gates. */
export function runChecks(input: InvoiceExtraction): CheckedExtraction {
  const confidence = { ...input.confidence };
  let supplierVat: string | null = null;
  if (input.supplier_vat !== null) {
    supplierVat = normaliseVat(clean(input.supplier_vat));
    if (supplierVat === null) confidence.supplier_vat = cap(confidence.supplier_vat);
  }

  const checked = input.lines.map((line) => checkLine(normaliseLine(line)));
  const data: InvoiceExtraction = {
    ...input,
    supplier_name: cleanOrNull(input.supplier_name),
    supplier_vat: supplierVat,
    invoice_number: cleanOrNull(input.invoice_number),
    payment_terms: cleanOrNull(input.payment_terms),
    lines: checked.map((entry) => entry.line),
    confidence,
  };

  const gate = totalsGate(data.lines, data.vat_total, data.gross_total);
  const confidences = [
    ...Object.values(data.confidence),
    ...data.lines.flatMap((line) => Object.values(line.confidence)),
  ];
  const gateFlags: GateFlag[] = [];
  if (gate.flagged) gateFlags.push("total_mismatch");
  if (confidences.some((value) => value < LOW_CONFIDENCE_THRESHOLD)) {
    gateFlags.push("low_confidence");
  }
  return {
    data,
    lineChecks: checked.map((entry) => entry.checks),
    gateFlags,
    totalsDiff: gate.diff,
  };
}
