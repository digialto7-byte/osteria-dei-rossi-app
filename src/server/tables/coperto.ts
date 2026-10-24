import type { SupabaseClient } from "@supabase/supabase-js";
import { mapTablesDbError } from "./errors";
import { copertoChangeOutput, copertoReadOutput } from "./output";
import type { CopertoBody } from "./schemas";

/** GET /api/settings/coperto: the coperto per person (null when none), the default VAT rate and the allowed rates. */
export async function readCoperto(supabase: SupabaseClient) {
  const { data, error } = await supabase.rpc("sale_settings_read");
  if (error) throw mapTablesDbError(error);
  return copertoReadOutput.parse(data);
}

/**
 * PATCH /api/settings/coperto: both keys, null and null clears. A change applies to tables opened from now on; the
 * sessions already open keep the amount frozen at their opening.
 */
export async function setCoperto(supabase: SupabaseClient, body: CopertoBody) {
  const { data, error } = await supabase.rpc("set_sale_settings", { p_patch: body });
  if (error) throw mapTablesDbError(error);
  return copertoChangeOutput.parse(data);
}
