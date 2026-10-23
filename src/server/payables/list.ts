import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { ApiError } from "@/lib/api/errors";
import { PAYABLE_LIST_PAGE_SIZE } from "./constants";
import { mapPayableDbError } from "./errors";
import {
  PAYABLE_FILTERS,
  type PayableFilter,
  type PayableItem,
  type PayableListResult,
  type PayableTotals,
} from "./types";

const CURSOR = /^(\d{4}-\d{2}-\d{2})_([0-9a-fA-F-]{36})$/;

const cursorSchema = z
  .string()
  .regex(CURSOR)
  .transform((value) => {
    const [, date = "", id = ""] = CURSOR.exec(value) ?? [];
    return { date, id };
  })
  .pipe(z.object({ date: z.iso.date(), id: z.uuid() }));

const listQuery = z.strictObject({
  filter: z.enum(PAYABLE_FILTERS).optional(),
  supplier: z.uuid().optional(),
  before: cursorSchema.optional(),
});

export interface ListPayablesQuery {
  filter: PayableFilter;
  supplier: string | null;
  cursor: { date: string; id: string } | null;
}

/** `?filter=unpaid|paid|all` (default unpaid), `?supplier=<uuid>`, `?before=<date>_<uuid>`; anything else is a 400. */
export function parsePayableListQuery(url: URL): ListPayablesQuery {
  const keys = [...url.searchParams.keys()];
  // A repeated parameter would silently keep only its last value; refuse it instead.
  const parsed = listQuery.safeParse(Object.fromEntries(url.searchParams));
  if (new Set(keys).size !== keys.length || !parsed.success)
    throw new ApiError(400, "invalid_request", "Filtri non validi.");
  return {
    filter: parsed.data.filter ?? "unpaid",
    supplier: parsed.data.supplier ?? null,
    cursor: parsed.data.before ?? null,
  };
}

interface ListRpc {
  items: PayableItem[];
  nextCursor: { date: string; id: string } | null;
  totals: PayableTotals | null;
  today: string;
}

export async function listPayables(
  supabase: SupabaseClient,
  query: ListPayablesQuery,
): Promise<PayableListResult> {
  const { data, error } = await supabase.rpc("payable_list", {
    p_filter: query.filter,
    p_supplier: query.supplier,
    p_cursor_date: query.cursor?.date ?? null,
    p_cursor_id: query.cursor?.id ?? null,
    p_limit: PAYABLE_LIST_PAGE_SIZE,
  });
  if (error) throw mapPayableDbError(error);
  const result = data as ListRpc;
  return {
    payables: result.items,
    nextCursor: result.nextCursor ? `${result.nextCursor.date}_${result.nextCursor.id}` : null,
    totals: result.totals,
    today: result.today,
  };
}
