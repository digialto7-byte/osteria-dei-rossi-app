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
  InvoiceReview,
  LineCheckCode,
  LineHighlight,
  ReviewLine,
  ReviewPack,
} from "@/server/invoices/review-types";
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
const MAX_REVIEW_LINES = 1000;

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

/** creditQty x unitPrice in euros, rounded to the cent, in integer maths. */
function creditAmount(creditQty: number, unitPrice: number | null): number | null {
  if (unitPrice === null) return null;
  const hundredMillionths = units(creditQty) * units(unitPrice);
  return Math.round(hundredMillionths / 1e6) / 100;
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

function toReviewLine(row: ReviewLineRow, lookups: Lookups): ReviewLine {
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
    creditAmount: creditAmount(creditQty, unitPrice),
    ingredient: ingredient
      ? { id: ingredient.id, name: ingredient.name, baseUnit: ingredient.base_unit }
      : null,
    pack,
    baseQty: row.is_stock ? baseQtyOf(qty, unit, ingredient?.base_unit, pack) : null,
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

  const active = source.lines
    .filter((row) => row.superseded_at === null)
    .map((row) => toReviewLine(row, lookups));
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

  const suppliers: ReviewSource["suppliers"] = [];
  if (supplierIds.length > 0) {
    suppliers.push(
      ...unwrap<ReviewSource["suppliers"]>(
        await supabase.from("supplier").select("id, name, vat_number").in("id", supplierIds),
      ),
    );
  }
  const ingredients: ReviewSource["ingredients"] = [];
  if (ingredientIds.length > 0) {
    ingredients.push(
      ...unwrap<ReviewSource["ingredients"]>(
        await supabase.from("ingredient").select("id, name, base_unit").in("id", ingredientIds),
      ),
    );
  }
  const items: ReviewSource["items"] = [];
  if (itemIds.length > 0) {
    items.push(
      ...unwrap<ReviewSource["items"]>(
        await supabase.from("supplier_item").select(ITEM_COLUMNS).in("id", itemIds),
      ),
    );
  }
  const costCentres: ReviewSource["costCentres"] = [];
  if (centreIds.length > 0) {
    costCentres.push(
      ...unwrap<ReviewSource["costCentres"]>(
        await supabase.from("cost_centre").select("id, name").in("id", centreIds),
      ),
    );
  }

  return buildReview({ invoice, suppliers, lines, ingredients, items, costCentres });
}
