import { z } from "zod";
import { ApiError } from "@/lib/api/errors";
import { STOCK_INPUT_UNITS, STOCK_QTY_MAX, UNIT_FACTOR, type StockInputUnit } from "./constants";
import { STOCK_REASON_CODES } from "./reasons";

export const idParams = z.object({ id: z.uuid() });

// The quantity in base units must be at least 0,0001 (the database rounds to 4 decimals and refuses 0), at most
// STOCK_QTY_MAX, and have at most 4 decimals after the conversion. The same limits as app.stock_qty_base.
function baseQtyIssue(qty: number, unit: StockInputUnit): string | null {
  const base = qty * UNIT_FACTOR[unit];
  const scaled = base * 10_000;
  if (Math.abs(scaled - Math.round(scaled)) > 1e-6) return "at most 4 decimals in the base unit";
  if (Math.round(scaled) < 1) return "too small";
  if (base > STOCK_QTY_MAX + 1e-9) return "too large";
  return null;
}

const quantity = {
  qty: z.number().positive().finite(),
  unit: z.enum(STOCK_INPUT_UNITS),
};

function checkQty(value: { qty: number; unit: StockInputUnit }, ctx: z.RefinementCtx) {
  const issue = baseQtyIssue(value.qty, value.unit);
  if (issue) ctx.addIssue({ code: "custom", path: ["qty"], message: issue });
}

export const wasteBody = z
  .strictObject({
    ingredientId: z.uuid(),
    ...quantity,
    reason: z.enum(STOCK_REASON_CODES),
    locationId: z.uuid().optional(),
    lotId: z.uuid().optional(),
  })
  .superRefine(checkQty);

export const transferBody = z
  .strictObject({
    ingredientId: z.uuid(),
    ...quantity,
    fromLocationId: z.uuid(),
    toLocationId: z.uuid(),
    lotId: z.uuid().optional(),
  })
  .superRefine(checkQty);

export const reverseBody = z.strictObject({});

export type WasteBody = z.infer<typeof wasteBody>;
export type TransferBody = z.infer<typeof transferBody>;

const invalid = (message: string) => new ApiError(400, "invalid_request", message);

/** A repeated parameter would silently keep only its last value; refuse it instead. */
function queryObject(url: URL): Record<string, string> {
  const keys = [...url.searchParams.keys()];
  if (new Set(keys).size !== keys.length) throw invalid("Filtri non validi.");
  return Object.fromEntries(url.searchParams);
}

function parseQuery<S extends z.ZodType>(schema: S, url: URL): z.infer<S> {
  const parsed = schema.safeParse(queryObject(url));
  if (!parsed.success) throw invalid("Filtri non validi.");
  return parsed.data;
}

const stockQuery = z.strictObject({ location: z.uuid().optional() });
/** `?location=<uuid>`; anything else is a 400. */
export function parseStockQuery(url: URL): { location: string | null } {
  return { location: parseQuery(stockQuery, url).location ?? null };
}

// A malformed ingredient id is the same 404 as a missing ingredient: it reveals nothing about existence.
function checkIngredientParam(url: URL): void {
  const ingredient = url.searchParams.get("ingredient");
  if (ingredient !== null && !z.uuid().safeParse(ingredient).success) {
    throw new ApiError(404, "not_found", "Risorsa non trovata.");
  }
}

const lotsQuery = z.strictObject({ ingredient: z.uuid(), empty: z.literal("1").optional() });
/** `?ingredient=<uuid>` (required), `?empty=1`. */
export function parseLotsQuery(url: URL): { ingredient: string; includeEmpty: boolean } {
  checkIngredientParam(url);
  const query = parseQuery(lotsQuery, url);
  return { ingredient: query.ingredient, includeEmpty: query.empty === "1" };
}

// `<created_at>_<handle id>`: an ISO timestamp (no underscore in it) and a uuid. The strict shape keeps
// anything that could change a filter built from it out.
const CURSOR =
  /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2}))_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

export interface MovementsCursor {
  createdAt: string;
  id: string;
}

export function parseMovementsCursor(text: string): MovementsCursor | null {
  const match = CURSOR.exec(text);
  return match ? { createdAt: match[1]!, id: match[2]! } : null;
}

const movementsQuery = z.strictObject({
  ingredient: z.uuid(),
  before: z.string().max(80).optional(),
});
/** `?ingredient=<uuid>` (required), `?before=<createdAt>_<uuid>`. */
export function parseMovementsQuery(url: URL): {
  ingredient: string;
  before: MovementsCursor | null;
} {
  checkIngredientParam(url);
  const query = parseQuery(movementsQuery, url);
  const before = query.before === undefined ? null : parseMovementsCursor(query.before);
  if (query.before !== undefined && !before) throw invalid("Filtri non validi.");
  return { ingredient: query.ingredient, before };
}

const wasteCostsQuery = z.strictObject({
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
});
/** `?from=YYYY-MM-DD&to=YYYY-MM-DD`; the defaults are the server's (the Rome month so far). */
export function parseWasteCostsQuery(url: URL): { from: string | null; to: string | null } {
  const query = parseQuery(wasteCostsQuery, url);
  return { from: query.from ?? null, to: query.to ?? null };
}
