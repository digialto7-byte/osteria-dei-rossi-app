import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "@/lib/api/errors";
import {
  MEASURE_UNITS,
  toIngredientBase,
  UnitError,
  type BaseUnit,
  type PackSpec,
  type QuantityUnit,
} from "@/lib/units";
import { LOW_CONFIDENCE_THRESHOLD } from "@/server/extraction/constants";
import { INVOICE_COLUMNS, toInvoiceItem, type InvoiceRow } from "@/server/invoices/invoices";
import type {
  ApprovalInfo,
  DueDateSource,
  InvoiceReview,
  LineCheckCode,
  LineHighlight,
  ReviewDecision,
  ReviewLine,
  ReviewPack,
  ReviewPosting,
} from "@/server/invoices/review-types";
import { mapReviewError } from "@/server/invoices/review-errors";
import { mapDbError, type DbError } from "@/server/master/db-errors";

/** Rows of one invoice, as PostgREST returns them. Numeric columns may arrive as strings. */
export interface ReviewInvoiceRow extends InvoiceRow {
  supplier_id: string | null;
  supplier_suggestion_id: string | null;
  header_corrected_fields: string[];
  payment_terms: string | null;
  /** Header confidence per field (server side only: used for the highlights, never returned). */
  field_confidence: Record<string, unknown> | null;
}

export interface ReviewLineRow {
  id: string;
  position: number;
  sub_position: number;
  parent_line_id: string | null;
  split_at: string | null;
  superseded_at: string | null;
  raw_description: string;
  supplier_code: string | null;
  qty: number;
  unit_raw: string | null;
  unit: string | null;
  unit_price: number | null;
  line_amount: number;
  vat_rate: number | null;
  lot_code: string | null;
  expiry: string | null;
  is_stock: boolean;
  cost_centre_id: string | null;
  credit_qty: number;
  ingredient_id: string | null;
  supplier_item_id: string | null;
  mapping_source: "auto" | "manual" | null;
  suggested_ingredient_id: string | null;
  field_confidence: Record<string, unknown> | null;
  checks: string[];
  corrected_fields: string[];
  reviewed_at: string | null;
}

/** What `public.invoice_approval_preview` returns (JSON; numbers are numbers, dates YYYY-MM-DD). */
export interface ApprovalPreview {
  status: string;
  blockers: { code: string; lineIds: string[] }[];
  receiptDate: string | null;
  payable: {
    grossAmount: number | null;
    creditedAmount: number | null;
    amount: number | null;
    dueDate: string | null;
    dueDateSource: DueDateSource | null;
  };
  receipts: number;
  lines: {
    lineId: string;
    receivedQty: number | null;
    baseUnit: BaseUnit | null;
    unitPrice: number | null;
    creditedAmount: number | null;
  }[];
  locations: {
    required: boolean;
    options: { id: string; name: string }[];
    defaultId: string | null;
  };
}

/** The newest approval or rejection of the invoice, with the actor's name and the chosen location. */
export interface DecisionRow {
  action: "invoice.approved" | "invoice.rejected";
  created_at: string;
  actor_name: string | null;
  reason: string | null;
  location_id: string | null;
}

export interface PayableRow {
  gross_amount: number | string;
  credited_amount: number | string;
  amount: number | string;
  due_date: string;
  due_date_source: DueDateSource;
  status: string;
}

export interface LotRow {
  invoice_line_id: string;
  qty_received: number | string;
  base_unit: BaseUnit;
}

export interface ReviewSource {
  invoice: ReviewInvoiceRow;
  suppliers: { id: string; name: string; vat_number: string | null }[];
  lines: ReviewLineRow[];
  ingredients: { id: string; name: string; base_unit: BaseUnit }[];
  items: {
    id: string;
    pack_count: number;
    pack_qty: number;
    pack_unit: string;
    pack_label: string | null;
  }[];
  costCentres: { id: string; name: string }[];
  /** The database's approval preview, read for invoices that have reviewed lines. */
  preview?: ApprovalPreview | null;
  /** Approved and rejected invoices only. */
  decision?: DecisionRow | null;
  payable?: PayableRow | null;
  locationName?: string | null;
  lots?: LotRow[];
}

// Lines are read in the database's vocabulary (snake_case), like `correctedFields`.
const LINE_CONFIDENCE_FIELDS = [
  "description",
  "supplier_code",
  "qty",
  "unit",
  "unit_price",
  "line_amount",
  "vat_rate",
  "lot_code",
  "expiry",
] as const;

// Header confidence key -> the field name used by `header_corrected_fields`.
const HEADER_CONFIDENCE_FIELDS = [
  ["supplier_name", "supplier_name"],
  ["supplier_vat", "supplier_vat"],
  ["invoice_number", "number_raw"],
  ["invoice_date", "invoice_date"],
  ["due_date", "due_date"],
  ["payment_terms", "payment_terms"],
  ["net_total", "net_total"],
  ["vat_total", "vat_total"],
  ["gross_total", "gross_total"],
] as const;

const LINE_UNITS: readonly string[] = [...MEASURE_UNITS, "conf"];
const LINE_CHECKS: readonly string[] = ["amount_mismatch", "vat_rate_unexpected"];
/**
 * The most lines one review reads. Extraction caps an invoice at MAX_EXTRACTED_LINES (200)
 * original lines, so 1000 leaves room for the parts of many splits; a unit test keeps the two in
 * step (at least five times the cap). It is a safety net, not a page size.
 */
export const MAX_REVIEW_LINES = 1000;

// Money is summed as whole ten-thousandths of a euro, never as floats.
const units = (value: number) => Math.round(value * 1e4);

const num = (value: unknown): number => Number(value);
const numOrNull = (value: unknown): number | null =>
  value === null || value === undefined ? null : Number(value);

const isWeak = (confidence: unknown) =>
  typeof confidence === "number" && confidence < LOW_CONFIDENCE_THRESHOLD;

function weakFields(
  confidence: Record<string, unknown> | null,
  fields: readonly string[],
): string[] {
  return confidence ? fields.filter((field) => isWeak(confidence[field])) : [];
}

type Lookups = {
  ingredients: Map<string, ReviewSource["ingredients"][number]>;
  items: Map<string, ReviewSource["items"][number]>;
  costCentres: Map<string, { id: string; name: string }>;
};

function packOf(item: ReviewSource["items"][number] | undefined): ReviewPack | null {
  if (!item) return null;
  return {
    count: num(item.pack_count),
    size: num(item.pack_qty),
    unit: item.pack_unit,
    label: item.pack_label,
  };
}

function baseQtyOf(
  qty: number,
  unit: QuantityUnit | null,
  baseUnit: BaseUnit | undefined,
  pack: ReviewPack | null,
): { qty: number; unit: BaseUnit } | null {
  if (!unit || !baseUnit) return null;
  try {
    return toIngredientBase(qty, unit, baseUnit, (pack as PackSpec | null) ?? undefined);
  } catch (error) {
    if (error instanceof UnitError) return null;
    throw error;
  }
}

type PreviewLine = ApprovalPreview["lines"][number];

function toReviewLine(
  row: ReviewLineRow,
  lookups: Lookups,
  previewLine: PreviewLine | undefined,
  lot: LotRow | undefined,
  aboutToPost: boolean,
): ReviewLine {
  const qty = num(row.qty);
  const unitPrice = numOrNull(row.unit_price);
  const creditQty = num(row.credit_qty);
  const unit = LINE_UNITS.includes(row.unit ?? "") ? (row.unit as QuantityUnit) : null;
  const ingredient = row.ingredient_id ? lookups.ingredients.get(row.ingredient_id) : undefined;
  const suggested = row.suggested_ingredient_id
    ? lookups.ingredients.get(row.suggested_ingredient_id)
    : undefined;
  const pack = packOf(row.supplier_item_id ? lookups.items.get(row.supplier_item_id) : undefined);
  const centre = row.cost_centre_id ? lookups.costCentres.get(row.cost_centre_id) : undefined;

  // A reviewed line no longer shows what the model was unsure about. Failed checks stay until fixed.
  const lowConfidenceFields = row.reviewed_at
    ? []
    : weakFields(row.field_confidence, LINE_CONFIDENCE_FIELDS);
  const checks = row.checks.filter((check): check is LineCheckCode => LINE_CHECKS.includes(check));
  const highlights: LineHighlight[] = [
    ...(lowConfidenceFields.length > 0 ? (["low_confidence"] as const) : []),
    ...checks,
  ];

  return {
    id: row.id,
    position: row.position,
    subPosition: row.sub_position,
    parentLineId: row.parent_line_id,
    isSplit: row.split_at !== null,
    rawDescription: row.raw_description,
    supplierCode: row.supplier_code,
    qty,
    unitRaw: row.unit_raw,
    unit,
    unitPrice,
    lineAmount: num(row.line_amount),
    vatRate: numOrNull(row.vat_rate),
    lotCode: row.lot_code,
    expiry: row.expiry,
    isStock: row.is_stock,
    costCentre: centre ? { id: centre.id, name: centre.name } : null,
    creditQty,
    creditAmount: numOrNull(previewLine?.creditedAmount),
    ingredient: ingredient
      ? { id: ingredient.id, name: ingredient.name, baseUnit: ingredient.base_unit }
      : null,
    pack,
    baseQty: row.is_stock ? baseQtyOf(qty, unit, ingredient?.base_unit, pack) : null,
    toReceive:
      aboutToPost &&
      previewLine &&
      previewLine.receivedQty !== null &&
      previewLine.baseUnit !== null
        ? {
            qty: num(previewLine.receivedQty),
            unit: previewLine.baseUnit,
            unitPrice: numOrNull(previewLine.unitPrice),
          }
        : null,
    received: lot ? { qty: num(lot.qty_received), unit: lot.base_unit } : null,
    mappingSource: row.mapping_source,
    suggestion:
      row.suggested_ingredient_id && suggested
        ? { ingredientId: suggested.id, ingredientName: suggested.name }
        : null,
    lowConfidenceFields,
    checks,
    highlights,
    corrected: row.corrected_fields.length > 0,
    correctedFields: row.corrected_fields,
    reviewedAt: row.reviewed_at,
  };
}

/** 0 = still to map, 1 = needs a look, 2 = the rest. */
function groupOf(line: ReviewLine): number {
  if (line.isStock && line.ingredient === null) return 0;
  return line.highlights.length > 0 ? 1 : 2;
}

const byPosition = (a: ReviewLine, b: ReviewLine) =>
  a.position - b.position || a.subPosition - b.subPosition;

function approvalOf(preview: ApprovalPreview | null | undefined): ApprovalInfo | null {
  if (!preview) return null;
  return {
    canApprove: preview.blockers.length === 0,
    blockers: preview.blockers.map((b) => ({ code: b.code, lineIds: b.lineIds })),
    receiptDate: preview.receiptDate,
    payable: {
      grossAmount: numOrNull(preview.payable.grossAmount),
      creditedAmount: numOrNull(preview.payable.creditedAmount),
      amount: numOrNull(preview.payable.amount),
      dueDate: preview.payable.dueDate,
      dueDateSource: preview.payable.dueDateSource,
    },
    receipts: num(preview.receipts),
    locations: {
      required: preview.locations.required,
      options: preview.locations.options.map((o) => ({ id: o.id, name: o.name })),
      defaultId: preview.locations.defaultId,
    },
  };
}

function decisionOf(status: string, row: DecisionRow | null | undefined): ReviewDecision | null {
  if (!row || (status !== "approved" && status !== "rejected")) return null;
  const rejected = row.action === "invoice.rejected";
  return {
    action: rejected ? "rejected" : "approved",
    at: row.created_at,
    byName: row.actor_name,
    reason: rejected ? row.reason : null,
  };
}

function postingOf(
  status: string,
  payable: PayableRow | null | undefined,
  locationName: string | null | undefined,
): ReviewPosting | null {
  if (status !== "approved" || !payable) return null;
  return {
    payable: {
      grossAmount: num(payable.gross_amount),
      creditedAmount: num(payable.credited_amount),
      amount: num(payable.amount),
      dueDate: payable.due_date,
      dueDateSource: payable.due_date_source,
      status: payable.status,
    },
    locationName: locationName ?? null,
  };
}

/**
 * Pure: turns the rows of one invoice into the review payload. Ordering, highlights, base
 * quantities and sums are decided here so that no screen has to compute them.
 */
export function buildReview(source: ReviewSource): InvoiceReview {
  const { invoice } = source;
  const lookups: Lookups = {
    ingredients: new Map(source.ingredients.map((row) => [row.id, row])),
    items: new Map(source.items.map((row) => [row.id, row])),
    costCentres: new Map(source.costCentres.map((row) => [row.id, row])),
  };

  const previewLines = new Map((source.preview?.lines ?? []).map((row) => [row.lineId, row]));
  // Only an invoice in review is about to post; the lots say what an approved one posted.
  const aboutToPost = invoice.status === "review";
  const lotByLine = new Map((source.lots ?? []).map((row) => [row.invoice_line_id, row]));
  const active = source.lines
    .filter((row) => row.superseded_at === null)
    .map((row) =>
      toReviewLine(row, lookups, previewLines.get(row.id), lotByLine.get(row.id), aboutToPost),
    );
  const childrenOf = new Map<string, ReviewLine[]>();
  for (const line of active) {
    if (line.parentLineId === null) continue;
    childrenOf.set(line.parentLineId, [...(childrenOf.get(line.parentLineId) ?? []), line]);
  }

  // Counted lines are the ones that will be received: an original line, or the parts of a split.
  const leaves: ReviewLine[] = [];
  const entries = active
    .filter((line) => line.parentLineId === null)
    .map((line) => {
      if (!line.isSplit) {
        leaves.push(line);
        return { line, group: groupOf(line) };
      }
      const children = (childrenOf.get(line.id) ?? []).sort(byPosition);
      leaves.push(...children);
      const group = children.length > 0 ? Math.min(...children.map(groupOf)) : 2;
      return { line: { ...line, children }, group };
    });
  entries.sort((a, b) => a.group - b.group || byPosition(a.line, b.line));

  const supplierById = new Map(source.suppliers.map((row) => [row.id, row]));
  const supplier = invoice.supplier_id ? supplierById.get(invoice.supplier_id) : undefined;
  const suggestion = invoice.supplier_suggestion_id
    ? supplierById.get(invoice.supplier_suggestion_id)
    : undefined;
  const corrected = new Set(invoice.header_corrected_fields);
  const item = toInvoiceItem(invoice);

  return {
    invoice: {
      ...item,
      supplierId: invoice.supplier_id,
      headerCorrectedFields: invoice.header_corrected_fields,
      lowConfidenceHeaderFields: HEADER_CONFIDENCE_FIELDS.filter(
        ([key, field]) => !corrected.has(field) && isWeak(invoice.field_confidence?.[key]),
      ).map(([, field]) => field),
    },
    supplier: supplier
      ? { id: supplier.id, name: supplier.name, vatNumber: supplier.vat_number }
      : null,
    supplierSuggestion: suggestion ? { id: suggestion.id, name: suggestion.name } : null,
    extractedSupplier: {
      name: invoice.supplier_name,
      vatNumber: invoice.supplier_vat,
      paymentTerms: invoice.payment_terms,
    },
    gate: {
      flags: item.gateFlags,
      totalsDiff: item.totalsDiff,
      linesTotal: leaves.reduce((sum, line) => sum + units(line.lineAmount), 0) / 1e4,
      vatTotal: item.vatTotal,
      grossTotal: item.grossTotal,
    },
    summary: {
      lines: leaves.length,
      unmapped: leaves.filter((line) => groupOf(line) === 0).length,
      toCheck: leaves.filter((line) => line.highlights.length > 0).length,
      corrected: leaves.filter((line) => line.corrected).length,
    },
    editable: invoice.status === "review",
    approval: invoice.status === "review" ? approvalOf(source.preview) : null,
    decision: decisionOf(invoice.status, source.decision),
    posting: postingOf(invoice.status, source.payable, source.locationName),
    lines: entries.map((entry) => entry.line),
  };
}

const INVOICE_REVIEW_COLUMNS = `${INVOICE_COLUMNS}, supplier_id, supplier_suggestion_id, header_corrected_fields, payment_terms, field_confidence`;
// Explicit list: nothing from the extraction baseline (`extracted`) leaves the database.
const LINE_COLUMNS =
  "id, position, sub_position, parent_line_id, split_at, superseded_at, raw_description, supplier_code, qty, unit_raw, unit, unit_price, line_amount, vat_rate, lot_code, expiry, is_stock, cost_centre_id, credit_qty, ingredient_id, supplier_item_id, mapping_source, suggested_ingredient_id, field_confidence, checks, corrected_fields, reviewed_at";
// supplier_item.last_price is deliberately absent (M5, and a cost).
const ITEM_COLUMNS = "id, pack_count, pack_qty, pack_unit, pack_label";

function unwrap<T>(result: { data: unknown; error: DbError | null }): T {
  if (result.error) throw mapDbError(result.error);
  return result.data as T;
}

const unique = (values: (string | null)[]) => [
  ...new Set(values.filter((value): value is string => value !== null)),
];

/** Ids per `.in("id", …)` request: PostgREST sends them in the URL, which has a length limit. */
export const ID_CHUNK_SIZE = 100;

/** Reads rows by id in chunks of ID_CHUNK_SIZE, so a long invoice never makes a long URL. */
async function selectByIds<T>(
  supabase: SupabaseClient,
  table: string,
  columns: string,
  ids: string[],
  column = "id",
): Promise<T[]> {
  const rows: T[] = [];
  for (let start = 0; start < ids.length; start += ID_CHUNK_SIZE) {
    rows.push(
      ...(unwrap<T[] | null>(
        await supabase
          .from(table)
          .select(columns)
          .in(column, ids.slice(start, start + ID_CHUNK_SIZE)),
      ) ?? []),
    );
  }
  return rows;
}

// Statuses whose lines the approval preview describes (earlier ones have no reviewed lines yet).
const PREVIEW_STATUSES: readonly string[] = ["review", "duplicate", "approved", "rejected"];
const DECISION_ACTION = { approved: "invoice.approved", rejected: "invoice.rejected" } as const;
// Costs stay out of every list below: no unit_cost (stock_movement), no last_price (supplier_item).
const PAYABLE_COLUMNS = "gross_amount, credited_amount, amount, due_date, due_date_source, status";
const LOT_COLUMNS = "invoice_line_id, qty_received, base_unit";

async function loadPreview(
  supabase: SupabaseClient,
  invoiceId: string,
): Promise<ApprovalPreview | null> {
  const { data, error } = await supabase.rpc("invoice_approval_preview", { p_invoice: invoiceId });
  if (error) throw mapReviewError(error);
  return (data as ApprovalPreview | null) ?? null;
}

/** The newest approval or rejection (owner and admin read `audit_event` through RLS). */
async function loadDecision(
  supabase: SupabaseClient,
  invoiceId: string,
  status: "approved" | "rejected",
): Promise<DecisionRow | null> {
  const audit = unwrap<{
    action: DecisionRow["action"];
    created_at: string;
    created_by: string | null;
    reason: string | null;
    after: { location_id?: string | null } | null;
  } | null>(
    await supabase
      .from("audit_event")
      .select("action, created_at, created_by, reason, after")
      .eq("entity_type", "invoice")
      .eq("entity_id", invoiceId)
      .eq("action", DECISION_ACTION[status])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  );
  if (!audit) return null;
  const actor = audit.created_by
    ? unwrap<{ display_name: string } | null>(
        await supabase
          .from("app_user")
          .select("display_name")
          .eq("id", audit.created_by)
          .maybeSingle(),
      )
    : null;
  return {
    action: audit.action,
    created_at: audit.created_at,
    actor_name: actor?.display_name ?? null,
    reason: audit.reason,
    location_id: audit.after?.location_id ?? null,
  };
}

/** The payable, location name and lots an approval posted. */
async function loadPosting(
  supabase: SupabaseClient,
  invoiceId: string,
  locationId: string | null,
  lineIds: string[],
) {
  const payable = unwrap<PayableRow | null>(
    await supabase
      .from("payable")
      .select(PAYABLE_COLUMNS)
      .eq("invoice_id", invoiceId)
      .maybeSingle(),
  );
  const location = locationId
    ? unwrap<{ name: string } | null>(
        await supabase.from("location").select("name").eq("id", locationId).maybeSingle(),
      )
    : null;
  const lots = await selectByIds<LotRow>(
    supabase,
    "raw_lot",
    LOT_COLUMNS,
    lineIds,
    "invoice_line_id",
  );
  return { payable, locationName: location?.name ?? null, lots };
}

/**
 * Reads one invoice with its lines and everything the review screen shows, through the user's
 * session (RLS: owner and admin of the tenant only). Sequential on purpose: a handful of indexed
 * queries, and each result is needed to decide which ids to look up next.
 */
export async function loadInvoiceReview(
  supabase: SupabaseClient,
  invoiceId: string,
): Promise<InvoiceReview> {
  const invoice = unwrap<ReviewInvoiceRow | null>(
    await supabase.from("invoice").select(INVOICE_REVIEW_COLUMNS).eq("id", invoiceId).maybeSingle(),
  );
  // RLS hides other tenants' rows and every row from chef and waiter: all read as missing.
  if (!invoice) throw new ApiError(404, "not_found", "Risorsa non trovata.");

  const lines = unwrap<ReviewLineRow[]>(
    await supabase
      .from("invoice_line")
      .select(LINE_COLUMNS)
      .eq("invoice_id", invoiceId)
      .is("superseded_at", null)
      .order("position")
      .order("sub_position")
      .limit(MAX_REVIEW_LINES),
  );

  const supplierIds = unique([invoice.supplier_id, invoice.supplier_suggestion_id]);
  const ingredientIds = unique(
    lines.flatMap((line) => [line.ingredient_id, line.suggested_ingredient_id]),
  );
  const itemIds = unique(lines.map((line) => line.supplier_item_id));
  const centreIds = unique(lines.map((line) => line.cost_centre_id));

  const suppliers = await selectByIds<ReviewSource["suppliers"][number]>(
    supabase,
    "supplier",
    "id, name, vat_number",
    supplierIds,
  );
  const ingredients = await selectByIds<ReviewSource["ingredients"][number]>(
    supabase,
    "ingredient",
    "id, name, base_unit",
    ingredientIds,
  );
  const items = await selectByIds<ReviewSource["items"][number]>(
    supabase,
    "supplier_item",
    ITEM_COLUMNS,
    itemIds,
  );
  const costCentres = await selectByIds<ReviewSource["costCentres"][number]>(
    supabase,
    "cost_centre",
    "id, name",
    centreIds,
  );

  const preview = PREVIEW_STATUSES.includes(invoice.status)
    ? await loadPreview(supabase, invoiceId)
    : null;
  const decided =
    invoice.status === "approved" || invoice.status === "rejected" ? invoice.status : null;
  const decision = decided ? await loadDecision(supabase, invoiceId, decided) : null;
  const posting =
    decided === "approved"
      ? await loadPosting(
          supabase,
          invoiceId,
          decision?.location_id ?? null,
          lines.map((line) => line.id),
        )
      : { payable: null, locationName: null, lots: [] };

  return buildReview({
    invoice,
    suppliers,
    lines,
    ingredients,
    items,
    costCentres,
    preview,
    decision,
    ...posting,
  });
}
