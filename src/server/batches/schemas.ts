import { z } from "zod";
import { ApiError } from "@/lib/api/errors";
import { STOCK_INPUT_UNITS } from "@/server/stock/constants";
import {
  BATCH_INPUTS_MAX,
  BATCH_OUTPUT_MAX,
  BATCH_PORTIONS_MAX,
  SHELF_LIFE_HOURS_MAX,
} from "./constants";

export const idParams = z.object({ id: z.uuid() });

// At most 4 decimals, the precision of the ledgers (the same tolerance as the stock schemas).
function hasAtMost4Decimals(value: number): boolean {
  const scaled = value * 10_000;
  return Math.abs(scaled - Math.round(scaled)) <= 1e-6;
}

const qty4 = z
  .number()
  .positive()
  .max(BATCH_OUTPUT_MAX)
  .refine(hasAtMost4Decimals, "at most 4 decimals");
/** An input quantity: 0 means "not used" (no movement, no lock). */
const qty4OrZero = z
  .number()
  .nonnegative()
  .max(BATCH_OUTPUT_MAX)
  .refine(hasAtMost4Decimals, "at most 4 decimals");

const shelfLifeHours = z.number().int().min(1).max(SHELF_LIFE_HOURS_MAX);

/**
 * POST /api/batches. Duplicates, the recipe's ingredient set, units and locations are checked in SQL only: one
 * source of truth, inside the production transaction.
 */
export const produceBody = z.strictObject({
  recipeId: z.uuid(),
  outputQty: qty4,
  portions: z.number().int().min(1).max(BATCH_PORTIONS_MAX).optional(),
  shelfLifeHours: shelfLifeHours.optional(),
  locationId: z.uuid().optional(),
  inputs: z
    .array(
      z.strictObject({
        ingredientId: z.uuid(),
        qty: qty4OrZero,
        unit: z.enum(STOCK_INPUT_UNITS),
        locationId: z.uuid().optional(),
        lotId: z.uuid().optional(),
      }),
    )
    .min(1)
    .max(BATCH_INPUTS_MAX),
});

export type ProduceBody = z.infer<typeof produceBody>;

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

// A decimal written the way the API documents it: digits, an optional point and 1 to 4 decimals (no comma, no
// exponent, no sign), turned into a number and bounded like the body.
const decimalQuery = z
  .string()
  .regex(/^\d{1,6}(\.\d{1,4})?$/)
  .transform(Number)
  .pipe(qty4);
const hoursQuery = z
  .string()
  .regex(/^\d{1,4}$/)
  .transform(Number)
  .pipe(shelfLifeHours);

const proposalQuery = z.strictObject({
  recipeKey: z.uuid(),
  outputQty: decimalQuery.optional(),
  shelfLifeHours: hoursQuery.optional(),
});

/** `?recipeKey=<uuid>` (required), `&outputQty=6.2`, `&shelfLifeHours=48`; anything else is a 400. */
export function parseProposalQuery(url: URL): {
  recipeKey: string;
  outputQty: number | null;
  shelfLifeHours: number | null;
} {
  const query = parseQuery(proposalQuery, url);
  return {
    recipeKey: query.recipeKey,
    outputQty: query.outputQty ?? null,
    shelfLifeHours: query.shelfLifeHours ?? null,
  };
}

// `<produced_at>_<batch id>`: an ISO timestamp (no underscore in it) and a uuid. The strict shape keeps anything
// that could change a filter built from it out.
const CURSOR =
  /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2}))_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

export interface BatchCursor {
  producedAt: string;
  id: string;
}

export function parseBatchCursor(text: string): BatchCursor | null {
  const match = CURSOR.exec(text);
  return match ? { producedAt: match[1]!, id: match[2]! } : null;
}

const listQuery = z.strictObject({
  recipeKey: z.uuid().optional(),
  before: z.string().max(80).optional(),
});

/** `?recipeKey=<uuid>`, `?before=<producedAt>_<uuid>`. */
export function parseBatchesQuery(url: URL): {
  recipeKey: string | null;
  before: BatchCursor | null;
} {
  const query = parseQuery(listQuery, url);
  const before = query.before === undefined ? null : parseBatchCursor(query.before);
  if (query.before !== undefined && !before) throw invalid("Filtri non validi.");
  return { recipeKey: query.recipeKey ?? null, before };
}
