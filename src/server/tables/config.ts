import type { SupabaseClient } from "@supabase/supabase-js";
import { mapTablesDbError } from "./errors";
import { createDiningTableOutput, diningTablesOutput, updateDiningTableOutput } from "./output";
import type { CreateDiningTableBody, UpdateDiningTableBody } from "./schemas";

// The owner's and admin's side of the tables: their names, order and whether they are in use.

/** GET /api/dining-tables: every table, active first, with whether it has an open session. */
export async function listDiningTables(supabase: SupabaseClient) {
  const { data, error } = await supabase.rpc("dining_tables_manage");
  if (error) throw mapTablesDbError(error);
  return diningTablesOutput.parse(data);
}

/** POST /api/dining-tables. */
export async function createDiningTable(supabase: SupabaseClient, body: CreateDiningTableBody) {
  const { data, error } = await supabase.rpc("create_dining_table", { p_body: body });
  if (error) throw mapTablesDbError(error);
  return createDiningTableOutput.parse(data);
}

/** PATCH /api/dining-tables/:id. Deactivating a table with an open session is a 409 table_open. */
export async function updateDiningTable(
  supabase: SupabaseClient,
  tableId: string,
  patch: UpdateDiningTableBody,
) {
  const { data, error } = await supabase.rpc("update_dining_table", {
    p_table: tableId,
    p_patch: patch,
  });
  if (error) throw mapTablesDbError(error);
  return updateDiningTableOutput.parse(data);
}
