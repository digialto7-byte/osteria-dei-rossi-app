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
  /**
   * The value of the credit in euros, VAT included, as the database computes it for the payable
   * (the approval preview). Null when no preview exists or the credit has no VAT rate.
   */
  creditAmount: number | null;
  ingredient: { id: string; name: string; baseUnit: BaseUnit } | null;
  pack: ReviewPack | null;
  /** The quantity in the ingredient's base unit (a preview kept from M4; `toReceive` is the posted figure). */
  baseQty: { qty: number; unit: BaseUnit } | null;
  /**
   * What approving will post for this line, from the database preview (review screen only):
   * quantity in the ingredient's base unit and the price per base unit, net of VAT. Null for a
   * line that posts nothing.
   */
  toReceive: { qty: number; unit: BaseUnit; unitPrice: number | null } | null;
  /** What approval posted for this line (approved invoices only), read from the stock lot. */
  received: { qty: number; unit: BaseUnit } | null;
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

export type DueDateSource = "invoice" | "supplier_terms";

export interface ApprovalBlocker {
  /** One of the approval error codes (`ErrorCode`), e.g. `lines_unmapped`. */
  code: string;
  /** The lines the blocker is about; empty when it is about the invoice as a whole. */
  lineIds: string[];
}

/** The other invoice of a look-alike pair: its id, document number as printed, and invoice date (YYYY-MM-DD). */
export interface DuplicatePartner {
  id: string;
  number: string;
  date: string;
}

export interface PayableFigures {
  grossAmount: number | null;
  creditedAmount: number | null;
  amount: number | null;
  dueDate: string | null;
  dueDateSource: DueDateSource | null;
}

/** The approval panel's data, only while the invoice is in `review`. Every figure comes from the database. */
export interface ApprovalInfo {
  canApprove: boolean;
  blockers: ApprovalBlocker[];
  /** The business date the receipts will carry (YYYY-MM-DD). */
  receiptDate: string | null;
  payable: PayableFigures;
  /** How many stock lines will be received. */
  receipts: number;
  locations: {
    required: boolean;
    options: { id: string; name: string }[];
    defaultId: string | null;
  };
}

/** Who approved or rejected the invoice, and when. `reason` is only set for a rejection. */
export interface ReviewDecision {
  action: "approved" | "rejected";
  at: string;
  byName: string | null;
  reason: string | null;
}

/** What an approval posted (approved invoices only). */
export interface ReviewPosting {
  payable: Omit<PayableFigures, "dueDateSource"> & {
    dueDateSource: DueDateSource;
    status: string;
  };
  locationName: string | null;
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
  /** The approval preview; null unless the invoice is in `review`. */
  approval: ApprovalInfo | null;
  /**
   * The look-alike the database blocks this invoice against now (the duplicate blocker of the approval
   * preview), for "Non è un doppione di FT 40 del 01/09/2026". Its id is what the action sends. Null when
   * nothing blocks it, or when a duplicate's original has left (rejected since).
   */
  duplicatePartner: DuplicatePartner | null;
  /** The approval or rejection; null while undecided. */
  decision: ReviewDecision | null;
  /** The payable and location an approval posted; null unless approved. */
  posting: ReviewPosting | null;
  lines: ReviewLine[];
}
