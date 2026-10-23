import { z } from "zod";
import { ApiError } from "@/lib/api/errors";
import { STOCK_INPUT_UNITS, UNIT_FACTOR, type StockInputUnit } from "@/server/stock/constants";
import { COUNT_LINES_MAX_PER_CALL, COUNT_QTY_MAX } from "./constants";

export const idParams = z.object({ id: z.uuid() });

export const COUNT_TYPES = ["daily", "monthly"] as const;
export const COUNT_STATUS_FILTERS = ["all", "open", "closed", "cancelled"] as const;

export const countStartBody = z.strictObject({
  type: z.enum(COUNT_TYPES),
  locationId: z.uuid().optional(),
});

// A counted quantity may be 0 ("none left"). In base units it is at most COUNT_QTY_MAX and has at most 4 decimals
// after the conversion: the same limits as app.count_qty_base.
function baseQtyIssue(qty: number, unit: StockInputUnit): string | null {
  const base = qty * UNIT_FACTOR[unit];
  const scaled = base * 10_000;
  if (Math.abs(scaled - Math.round(scaled)) > 1e-6) return "at most 4 decimals in the base unit";
  if (base > COUNT_QTY_MAX + 1e-9) return "too large";
  return null;
}

const countLine = z
  .strictObject({
    ingredientId: z.uuid(),
    qty: z.number().min(0).finite().nullable(),
    unit: z.enum(STOCK_INPUT_UNITS),
  })
  .superRefine((line, ctx) => {
    if (line.qty === null) return;
    const issue = baseQtyIssue(line.qty, line.unit);
    if (issue) ctx.addIssue({ code: "custom", path: ["qty"], message: issue });
  });

export const countLinesBody = z
  .strictObject({ lines: z.array(countLine).min(1).max(COUNT_LINES_MAX_PER_CALL) })
  .superRefine((body, ctx) => {
    const ids = body.lines.map((line) => line.ingredientId);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: "custom", path: ["lines"], message: "duplicate ingredient" });
    }
  });

export const closeBody = z.strictObject({});
export const cancelBody = z.strictObject({});

export const criticalBody = z.strictObject({ ingredientId: z.uuid(), critical: z.boolean() });

export type CountStartBody = z.infer<typeof countStartBody>;
export type CountLinesBody = z.infer<typeof countLinesBody>;
export type CriticalBody = z.infer<typeof criticalBody>;

const invalid = (message: string) => new ApiError(400, "invalid_request", message);

/** A repeated parameter would silently keep only its last value; refuse it instead. */
function queryObject(url: URL): Record<string, string> {
  const keys = [...url.searchParams.keys()];
  if (new Set(keys).size !== keys.length) throw invalid("Filtri non validi.");
  return Object.fromEntries(url.searchParams);
}

export function parseQuery<S extends z.ZodType>(schema: S, url: URL): z.infer<S> {
  const parsed = schema.safeParse(queryObject(url));
  if (!parsed.success) throw invalid("Filtri non validi.");
  return parsed.data;
}

// `<instant>_<uuid>`: an ISO timestamp (no underscore in it) and a uuid. The strict shape keeps anything that could
// change a filter built from it out.
const CURSOR =
  /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2}))_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

export interface TimeCursor {
  at: string;
  id: string;
}

export function parseCursor(text: string): TimeCursor | null {
  const match = CURSOR.exec(text);
  return match ? { at: match[1]!, id: match[2]! } : null;
}

/** An optional `?before=` value: absent is null, malformed is a 400. */
export function readCursor(text: string | undefined): TimeCursor | null {
  if (text === undefined) return null;
  const cursor = parseCursor(text);
  if (!cursor) throw invalid("Filtri non validi.");
  return cursor;
}

const countsQuery = z.strictObject({
  status: z.enum(COUNT_STATUS_FILTERS).optional(),
  before: z.string().max(80).optional(),
});
/** `?status=open|closed|cancelled|all`, `?before=<instant>_<uuid>`. */
export function parseCountsQuery(url: URL): {
  status: (typeof COUNT_STATUS_FILTERS)[number];
  before: TimeCursor | null;
} {
  const query = parseQuery(countsQuery, url);
  return { status: query.status ?? "all", before: readCursor(query.before) };
}

const varianceQuery = z.strictObject({ session: z.uuid() });
/** `?session=<uuid>` (required). */
export function parseVarianceQuery(url: URL): { session: string } {
  return { session: parseQuery(varianceQuery, url).session };
}

const reconciliationQuery = z.strictObject({
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  location: z.uuid().optional(),
});
/** `?from=YYYY-MM-DD&to=YYYY-MM-DD&location=<uuid>`; the defaults are the service's (the Rome month so far). */
export function parseReconciliationQuery(url: URL): {
  from: string | null;
  to: string | null;
  location: string | null;
} {
  const query = parseQuery(reconciliationQuery, url);
  return { from: query.from ?? null, to: query.to ?? null, location: query.location ?? null };
}
