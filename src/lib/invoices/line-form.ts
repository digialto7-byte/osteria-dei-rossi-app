import { t } from "@/lib/i18n";
import { fieldLabel } from "@/lib/invoices/review-view";
import { parseDecimal, toField } from "@/lib/numbers/parse-decimal";
import type { ReviewLine } from "@/server/invoices/review-types";

/** The line editor's fields, as text (what the inputs hold). */
export interface LineForm {
  qty: string;
  unitPrice: string;
  lineAmount: string;
  vatRate: string;
  supplierCode: string;
  unit: string;
  ingredientId: string;
  packCount: string;
  packSize: string;
  packUnit: string;
  packLabel: string;
  isStock: boolean;
  costCentreId: string;
  creditQty: string;
  lotCode: string;
  expiry: string;
}

export function initialLineForm(line: ReviewLine): LineForm {
  return {
    qty: toField(line.qty),
    unitPrice: toField(line.unitPrice),
    lineAmount: toField(line.lineAmount),
    vatRate: toField(line.vatRate),
    supplierCode: line.supplierCode ?? "",
    unit: line.unit ?? "",
    ingredientId: line.ingredient?.id ?? "",
    packCount: line.pack ? toField(line.pack.count) : "",
    packSize: line.pack ? toField(line.pack.size) : "",
    packUnit: line.pack?.unit ?? "",
    packLabel: line.pack?.label ?? "",
    isStock: line.isStock,
    costCentreId: line.costCentre?.id ?? "",
    creditQty: line.creditQty > 0 ? toField(line.creditQty) : "",
    lotCode: line.lotCode ?? "",
    expiry: line.expiry ?? "",
  };
}

export type PatchResult =
  { ok: true; patch: Record<string, unknown> } | { ok: false; field: string; message: string };

const FIELD_NAME: Record<string, string> = {
  qty: "qty",
  unitPrice: "unit_price",
  lineAmount: "line_amount",
  vatRate: "vat_rate",
  creditQty: "credit_qty",
};

const bad = (field: string, key: "review.error.number" | "review.error.pack"): PatchResult => ({
  ok: false,
  field,
  message: t(key, { field: fieldLabel(FIELD_NAME[field] ?? field) }),
});

const textOrNull = (value: string) => value.trim() || null;

/**
 * The PATCH body for "Salva riga": only the fields that differ from the line, plus `reviewed`
 * (saving a line marks it checked). Rules that need the database (a cost centre for non-stock,
 * a credit within the quantity) are left to the API, whose Italian message the screen shows.
 * A part of a split line (`child`) has fixed quantity and amounts and no code, credit or pack.
 */
export function buildLinePatch(
  line: ReviewLine,
  form: LineForm,
  { child = false }: { child?: boolean } = {},
): PatchResult {
  const patch: Record<string, unknown> = {};

  const number = (
    field: "qty" | "unitPrice" | "lineAmount" | "vatRate" | "creditQty",
    current: number | null,
    { required = false, empty = null }: { required?: boolean; empty?: number | null } = {},
  ): PatchResult | null => {
    const read = parseDecimal(form[field]);
    if (!read.ok || (required && read.value === null)) return bad(field, "review.error.number");
    const next = read.value ?? empty;
    if (next !== current) patch[field] = next;
    return null;
  };

  if (!child) {
    for (const failure of [
      number("qty", line.qty, { required: true }),
      number("unitPrice", line.unitPrice),
      number("lineAmount", line.lineAmount, { required: true }),
    ]) {
      if (failure) return failure;
    }
  }
  const vat = number("vatRate", line.vatRate);
  if (vat) return vat;
  if (!child) {
    const credit = number("creditQty", line.creditQty, { empty: 0 });
    if (credit) return credit;
    if (textOrNull(form.supplierCode) !== line.supplierCode) {
      patch.supplierCode = textOrNull(form.supplierCode);
    }
  }
  if ((form.unit || null) !== line.unit) patch.unit = form.unit || null;
  if (textOrNull(form.lotCode) !== line.lotCode) patch.lotCode = textOrNull(form.lotCode);
  if ((form.expiry || null) !== line.expiry) patch.expiry = form.expiry || null;

  if (!form.isStock) {
    // The API wants the flag and the centre together, and refuses a missing centre itself.
    if (line.isStock || form.costCentreId !== (line.costCentre?.id ?? "")) {
      patch.isStock = false;
      if (form.costCentreId) patch.costCentreId = form.costCentreId;
    }
  } else {
    if (!line.isStock) patch.isStock = true;
    if ((form.ingredientId || null) !== (line.ingredient?.id ?? null)) {
      patch.ingredientId = form.ingredientId || null;
    }
    const pack = packOf(line, form, child);
    if (pack && !pack.ok) return pack.failure;
    if (pack?.value) patch.pack = pack.value;
  }

  patch.reviewed = true;
  return { ok: true, patch };
}

function packOf(line: ReviewLine, form: LineForm, child: boolean) {
  if (child) return null;
  const fields = [form.packCount, form.packSize, form.packUnit];
  if (fields.every((value) => value === "")) return null;
  const count = parseDecimal(form.packCount);
  const size = parseDecimal(form.packSize);
  if (!count.ok || !size.ok || count.value === null || size.value === null || !form.packUnit) {
    return { ok: false as const, failure: bad("pack", "review.error.pack") };
  }
  const value = {
    count: count.value,
    size: size.value,
    unit: form.packUnit,
    label: textOrNull(form.packLabel),
  };
  const current = line.pack;
  const same =
    current !== null &&
    current.count === value.count &&
    current.size === value.size &&
    current.unit === value.unit &&
    (current.label ?? null) === value.label;
  return { ok: true as const, value: same ? null : value };
}
