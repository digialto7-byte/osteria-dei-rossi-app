import type { InvoiceItem } from "@/server/invoices/invoices";
import type { BaseUnit, QuantityUnit } from "@/lib/units";

/** A check the database recomputes after every line edit. */
export type LineCheckCode = "amount_mismatch" | "vat_rate_unexpected";
/** Why a line asks for the reviewer's eyes. `low_confidence` lists its fields in `lowConfidenceFields`. */
export type LineHighlight = "low_confidence" | LineCheckCode;

export interface ReviewPack {
  count: number;
  size: number;
  unit: string;
  label: string | null;
}

export interface ReviewLine {
  id: string;
  position: number;
  /** 0 for an original line; 1.. for the parts of a split. */
  subPosition: number;
  parentLineId: string | null;
  isSplit: boolean;
  /** The active parts of a split line, by sub-position; absent on every other line. */
  children?: ReviewLine[];
  rawDescription: string;
  supplierCode: string | null;
  qty: number;
  unitRaw: string | null;
  unit: QuantityUnit | null;
  unitPrice: number | null;
  lineAmount: number;
  vatRate: number | null;
  lotCode: string | null;
  expiry: string | null;
  isStock: boolean;
  costCentre: { id: string; name: string } | null;
  creditQty: number;
  /** creditQty x unitPrice in euros, rounded to the cent. A preview only; M5 computes the payable. */
  creditAmount: number | null;
  ingredient: { id: string; name: string; baseUnit: BaseUnit } | null;
  pack: ReviewPack | null;
  /** The quantity in the ingredient's base unit (a preview; posted in M5). */
  baseQty: { qty: number; unit: BaseUnit } | null;
  mappingSource: "auto" | "manual" | null;
  suggestion: { ingredientId: string; ingredientName: string } | null;
  /** Fields read below the confidence threshold and not yet reviewed. */
  lowConfidenceFields: string[];
  checks: LineCheckCode[];
  highlights: LineHighlight[];
  corrected: boolean;
  correctedFields: string[];
  reviewedAt: string | null;
}

export interface InvoiceReview {
  invoice: InvoiceItem & {
    supplierId: string | null;
    headerCorrectedFields: string[];
    /** Header fields read below the threshold and not corrected since. */
    lowConfidenceHeaderFields: string[];
  };
  supplier: { id: string; name: string; vatNumber: string | null } | null;
  supplierSuggestion: { id: string; name: string } | null;
  /** What the document printed: the prefill for "Crea fornitore". */
  extractedSupplier: { name: string | null; vatNumber: string | null; paymentTerms: string | null };
  gate: {
    flags: string[];
    totalsDiff: number | null;
    linesTotal: number;
    vatTotal: number | null;
    grossTotal: number | null;
  };
  summary: { lines: number; unmapped: number; toCheck: number; corrected: number };
  /** True only while the invoice is in `review`. */
  editable: boolean;
  lines: ReviewLine[];
}
