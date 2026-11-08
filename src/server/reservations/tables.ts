import type { SupabaseClient } from "@supabase/supabase-js";
import { mapReservationsDbError } from "./errors";
import {
  createTableGroupOutput,
  deactivateTableGroupOutput,
  setTableBookingOutput,
  tableBookingOutput,
} from "./output";
import type { TableBookingBody, TableGroupBody } from "./schemas";

/** GET /api/settings/reservations/tables: every active table with its bookable flag and seats, and the active groups. */
export async function readTableBooking(supabase: SupabaseClient) {
  const { data, error } = await supabase.rpc("table_booking");
  if (error) throw mapReservationsDbError(error);
  return tableBookingOutput.parse(data);
}

/** PUT /api/settings/reservations/tables: the tables listed change; the others stay. Another tenant's table is a 404. */
export async function saveTableBooking(supabase: SupabaseClient, body: TableBookingBody) {
  const { data, error } = await supabase.rpc("set_table_booking", { p_body: body });
  if (error) throw mapReservationsDbError(error);
  return setTableBookingOutput.parse(data);
}

/** POST /api/table-groups. Members never change afterwards: to edit a group, deactivate it and create a new one. */
export async function createTableGroup(supabase: SupabaseClient, body: TableGroupBody) {
  const { data, error } = await supabase.rpc("create_table_group", { p_body: body });
  if (error) throw mapReservationsDbError(error);
  return createTableGroupOutput.parse(data);
}

/** POST /api/table-groups/:id/deactivate. */
export async function deactivateTableGroup(supabase: SupabaseClient, groupId: string) {
  const { data, error } = await supabase.rpc("deactivate_table_group", { p_group: groupId });
  if (error) throw mapReservationsDbError(error);
  return deactivateTableGroupOutput.parse(data);
}
