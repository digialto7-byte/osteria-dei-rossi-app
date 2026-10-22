import { z } from "zod";
import { decimals4 } from "@/lib/numbers/decimals";
import { LINE_UNITS, MEASURE_UNITS } from "@/lib/units";
import { procedureError } from "@/server/invoices/review-errors";
import { NON_EMPTY_MESSAGE, nonEmpty } from "@/server/master/schemas";

export const lineParams = z.object({ id: z.uuid(), lineId: z.uuid() });

// Same caps as the extraction schema (M3): numeric(12,4) columns, at most 4 decimals.
const MAX_AMOUNT = 1e6;
const amount = z.number().min(0).max(MAX_AMOUNT).refine(decimals4, "at most 4 decimals");
const positive = z.number().gt(0).max(MAX_AMOUNT).refine(decimals4, "at most 4 decimals");
const text = (max: number) => z.string().trim().max(max);

const packBody = z.strictObject({
  count: positive,
  size: positive,
  unit: z.enum(MEASURE_UNITS),
  label: text(30).nullable().optional(),
});

export const linePatchBody = z
  .object({
    qty: amount,
    unitPrice: amount.nullable(),
    lineAmount: amount,
    vatRate: z.number().min(0).max(100).refine(decimals4, "at most 4 decimals").nullable(),
    supplierCode: text(64).nullable(),
    unit: z.enum(LINE_UNITS).nullable(),
    ingredientId: z.uuid().nullable(),
    pack: packBody,
    isStock: z.boolean(),
    costCentreId: z.uuid().nullable(),
    creditQty: amount,
    lotCode: text(64).nullable(),
    expiry: z.iso.date().nullable(),
    reviewed: z.literal(true),
  })
  .partial()
  .refine(nonEmpty, NON_EMPTY_MESSAGE)
  .refine(
    (body) => body.isStock !== true || body.costCentreId == null,
    "costCentreId: solo per le righe non a magazzino.",
  );

const splitChild = z.strictObject({ qty: positive, lineAmount: amount });
/** A line is divided into 2 to 10 parts; their sums are checked against the line (plan §3.2). */
export const splitBody = z.object({ children: z.array(splitChild).min(2).max(10) });
export type SplitBody = z.infer<typeof splitBody>;

/** Unsplit takes no fields. */
export const emptyBody = z.object({});

const idOnly = z.uuid();
const newSupplier = z.strictObject({
  name: z.string().trim().min(1).max(200),
  vatNumber: z.string().max(20).nullable().optional(),
  paymentTermsDays: z.number().int().min(0).max(365).nullable().optional(),
});
/** Link an existing supplier, or create one from the extracted data: exactly one of the two. */
export const supplierBody = z
  .object({ supplierId: idOnly.optional(), create: newSupplier.optional() })
  .refine((body) => (body.supplierId === undefined) !== (body.create === undefined), {
    message: "Indica supplierId oppure create.",
  });
export type SupplierBody = z.infer<typeof supplierBody>;

const total = z.number().min(0).max(1e7).refine(decimals4, "at most 4 decimals");
export const headerPatchBody = z
  .object({
    numberRaw: text(64).nullable(),
    invoiceDate: z.iso.date().nullable(),
    dueDate: z.iso.date().nullable(),
    netTotal: total.nullable(),
    vatTotal: total.nullable(),
    grossTotal: total.nullable(),
  })
  .partial()
  .refine(nonEmpty, NON_EMPTY_MESSAGE);
export type HeaderPatchBody = z.infer<typeof headerPatchBody>;

export type LinePatchBody = z.infer<typeof linePatchBody>;

/**
 * Rules that need no database, answered with the documented 422 codes before any call (the
 * procedure and the table checks repeat them). A credit above the stored qty is checked by the
 * service, which reads the line.
 */
export function checkLinePatchRules(
  body: Pick<LinePatchBody, "isStock" | "costCentreId" | "qty" | "creditQty">,
): void {
  if (body.isStock === false && !body.costCentreId) throw procedureError("cost_centre_required");
  if (body.creditQty !== undefined && body.qty !== undefined && body.creditQty > body.qty) {
    throw procedureError("credit_qty_exceeds_qty");
  }
}
