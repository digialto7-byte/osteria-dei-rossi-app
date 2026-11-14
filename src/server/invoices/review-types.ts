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

/** What the XML file said about one line (P2-7). Amounts are numbers, like every other amount of the reply. */
export interface ReviewLineXml {
  /** NumeroLinea of the file; null for the line Costì added for a rounding difference. */
  lineNumber: number | null;
  /** The kind of line (SC, PR, AB, AC), or "residual" for the line Costì added; null for an ordinary line. */
  kind: "SC" | "PR" | "AB" | "AC" | "residual" | null;
  /** CodiceArticolo, in file order; the first one is the supplier code Costì uses. */
  codes: { type: string; value: string }[];
  /** AltriDatiGestionali, as written: Costì does not interpret the label. */
  otherData: { type: string; text: string | null; number: number | null; date: string | null }[];
  discounts: { type: string; percent: number | null; amount: number | null }[];
  /** PrezzoUnitario before the discounts; `unitPrice` of the line is the effective net price. */
  listUnitPrice: number | null;
  vatNature: string | null;
  vatNatureLabel: string | null;
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
  /** A stock line received without a lot code: the screen marks it ("Lotto mancante"). The approval is never blocked by it (P2-2 plan §3.6). */
  lotMissing: boolean;
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
  /** The file's own data for the line; null for a document invoice and for a line that has none. */
  xml: ReviewLineXml | null;
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
  /** The partner's gross total (euros), for the comparison "importi uguali / diversi". */
  grossTotal: number | null;
  /** "xml" when the partner was read from an e-invoice file, "document" for a photo or PDF. */
  format: "xml" | "document";
  status: string;
  /** The two gross totals differ by at most 0,05 euro; null when one of them is missing. */
  amountsMatch: boolean | null;
}

/** What the invoice's XML file said at the top level (P2-7); null for a photo or PDF. */
export interface ReviewInvoiceXml {
  format: "FPR12" | "FPA12";
  documentType: string;
  documentTypeLabel: string;
  /** A .p7m: opened, the signature not verified by Costì. */
  signed: boolean;
  bodyIndex: number;
  bodyCount: number;
  /** What the file held that Costì did not import, with the wording the screen shows. */
  notes: { code: string; label: string }[];
}

/** One row of the file's VAT summary (DatiRiepilogo). */
export interface ReviewVatRow {
  rate: number;
  nature: string | null;
  natureLabel: string | null;
  taxable: number;
  tax: number;
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
    xml: ReviewInvoiceXml | null;
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
  summary: {
    lines: number;
    unmapped: number;
    toCheck: number;
    corrected: number;
    /** The received (leaf) stock lines marked `lotMissing`: the pre-approval count. */
    stockLinesWithoutLot: number;
  };
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
  /** The file's VAT summary, in the file's order; empty for a photo or PDF. */
  vatSummary: ReviewVatRow[];
  /**
   * "Usa il file XML al posto del PDF": set only for an XML invoice that is a duplicate of a photo or PDF still in review.
   * `partnerId` is what the action sends as `replaces`.
   */
  replaceWithXml: { partnerId: string } | null;
  /** The approval or rejection; null while undecided. */
  decision: ReviewDecision | null;
  /** The payable and location an approval posted; null unless approved. */
  posting: ReviewPosting | null;
  lines: ReviewLine[];
}
