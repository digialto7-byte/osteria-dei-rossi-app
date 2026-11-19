import { z } from "zod";
import { ApiError } from "@/lib/api/errors";
import {
  OPENING_COST_MAX,
  OPENING_DECIMALS,
  OPENING_MAX_LINES,
  OPENING_QTY_MAX,
  OPENING_REVERSAL_REASONS,
} from "./constants";

// Strict request bodies of /api/stock/opening/* (plan 2026-11-18 §3.9). Every check is repeated in SQL (app.opening_line_values),
// because a Data API caller skips Zod; more than 4 decimals is refused here and there, never rounded.

const SCALE = 10 ** OPENING_DECIMALS;
const atMostDecimals = (value: number) =>
  Math.abs(value * SCALE - Math.round(value * SCALE)) < 1e-6;

const qty = z
  .number()
  .finite()
  .positive()
  .max(OPENING_QTY_MAX)
  .refine(atMostDecimals, { message: "at most 4 decimals" });
const unitCostEur = z
  .number()
  .finite()
  .min(0)
  .max(OPENING_COST_MAX)
  .refine(atMostDecimals, { message: "at most 4 decimals" });

/** A real calendar date written YYYY-MM-DD (2026-02-30 is refused). */
const calendarDate = z.iso.date().refine((value) => {
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}, "not a calendar date");

const confirmLine = z.strictObject({ id: z.uuid(), ingredientId: z.uuid(), qty, unitCostEur });
const draftLine = z.strictObject({
  id: z.uuid(),
  locationId: z.uuid(),
  ingredientId: z.uuid(),
  qty,
  unitCostEur,
});

export const draftPutBody = z.strictObject({
  lines: z.array(draftLine).min(1).max(OPENING_MAX_LINES),
});

export const confirmBody = z.strictObject({
  locationId: z.uuid(),
  effectiveOn: calendarDate,
  requestId: z.uuid(),
  lines: z.array(confirmLine).min(1).max(OPENING_MAX_LINES),
});

export const reverseBody = z.strictObject({ reason: z.enum(OPENING_REVERSAL_REASONS) });

export const idParams = z.object({ id: z.uuid() });

export type DraftPutBody = z.infer<typeof draftPutBody>;
export type ConfirmBody = z.infer<typeof confirmBody>;
export type ReverseBody = z.infer<typeof reverseBody>;

const locationQuerySchema = z.strictObject({ locationId: z.uuid() });

/** `?locationId=<uuid>`, required and alone; anything else (missing, repeated, malformed, an extra key) is a 400. */
export function locationQuery(url: URL): { locationId: string } {
  const keys = [...url.searchParams.keys()];
  const parsed = locationQuerySchema.safeParse(Object.fromEntries(url.searchParams));
  if (new Set(keys).size !== keys.length || !parsed.success) {
    throw new ApiError(400, "invalid_request", "Ubicazione non valida.");
  }
  return parsed.data;
}
