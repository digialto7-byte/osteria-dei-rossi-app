import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "@/lib/api/errors";
import { mapDbError, type DbError } from "./db-errors";

/** Lists are small reference data; this bounds a response if a tenant ever grows large. */
export const MAX_LIST_ROWS = 1000;

export type ActiveFilter = boolean | "all";

/** `?active=true|false|all`, default true (deactivated rows are hidden unless asked for). */
export function parseActiveFilter(url: URL): ActiveFilter {
  const value = url.searchParams.get("active");
  if (value === "all") return "all";
  if (value === "false") return false;
  return true;
}

/** How one master-data table is read and shown through the API. */
export interface ResourceSpec<Row, Item> {
  table: string;
  columns: string;
  /** List order; most tables sort by name. */
  orderBy?: string;
  toItem(row: Row): Item;
}

interface QueryResult {
  data: unknown;
  error: DbError | null;
}

function unwrap(result: QueryResult): unknown {
  if (result.error) throw mapDbError(result.error);
  return result.data;
}

const notFound = () => new ApiError(404, "not_found", "Risorsa non trovata.");

export async function listRows<Row, Item>(
  supabase: SupabaseClient,
  spec: ResourceSpec<Row, Item>,
  active: ActiveFilter,
  filters: Record<string, string> = {},
): Promise<Item[]> {
  let query = supabase.from(spec.table).select(spec.columns);
  for (const [column, value] of Object.entries(filters)) query = query.eq(column, value);
  if (active !== "all") query = query.eq("is_active", active);
  const rows = unwrap(await query.order(spec.orderBy ?? "name").limit(MAX_LIST_ROWS)) as Row[];
  return rows.map(spec.toItem);
}

export async function getRow<Row, Item>(
  supabase: SupabaseClient,
  spec: ResourceSpec<Row, Item>,
  id: string,
): Promise<Item> {
  const row = unwrap(
    await supabase.from(spec.table).select(spec.columns).eq("id", id).maybeSingle(),
  ) as Row | null;
  if (!row) throw notFound();
  return spec.toItem(row);
}

export async function insertRow<Row, Item>(
  supabase: SupabaseClient,
  spec: ResourceSpec<Row, Item>,
  values: Record<string, unknown>,
): Promise<Item> {
  const row = unwrap(
    await supabase.from(spec.table).insert(values).select(spec.columns).single(),
  ) as Row;
  return spec.toItem(row);
}

export async function updateRow<Row, Item>(
  supabase: SupabaseClient,
  spec: ResourceSpec<Row, Item>,
  id: string,
  values: Record<string, unknown>,
): Promise<Item> {
  const row = unwrap(
    await supabase.from(spec.table).update(values).eq("id", id).select(spec.columns).maybeSingle(),
  ) as Row | null;
  // RLS hides rows of other tenants and blocks roles without write access: both read as missing.
  if (!row) throw notFound();
  return spec.toItem(row);
}

/** Drops undefined keys so a PATCH only touches the fields it names. */
export function definedOnly(values: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined));
}
