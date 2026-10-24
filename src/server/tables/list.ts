import type { SupabaseClient } from "@supabase/supabase-js";
import { mapTablesDbError } from "./errors";
import { tablesListOutput } from "./output";

/**
 * GET /api/tables: the active tables with their derived status and session. Owner, admin and waiter read the same
 * shape; the status is the database's derivation, never computed here.
 */
export async function listTables(supabase: SupabaseClient) {
  const { data, error } = await supabase.rpc("tables_list");
  if (error) throw mapTablesDbError(error);
  return tablesListOutput.parse(data);
}
