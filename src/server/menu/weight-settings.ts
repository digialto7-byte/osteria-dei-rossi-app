import type { SupabaseClient } from "@supabase/supabase-js";
import { mapMenuDbError } from "./errors";
import { setWeightSettingsOutput, weightSettingsOutput } from "./output";
import type { WeightSettingsBody } from "./schemas";

// The tenant's maximum weight per line (P2-0b, plan P-4). Owner and admin only, in Postgres (`app.require_menu_writer`) as well
// as at the route. Each call is one RPC, one transaction; this only passes the body and parses the answer.

/** GET /api/settings/weight. */
export async function readWeightSettings(supabase: SupabaseClient) {
  const { data, error } = await supabase.rpc("weight_settings");
  if (error) throw mapMenuDbError(error);
  return weightSettingsOutput.parse(data);
}

/** PUT /api/settings/weight: `{weightMaxG: int | null}`; the same value again answers `changed: false`. */
export async function setWeightSettings(supabase: SupabaseClient, body: WeightSettingsBody) {
  const { data, error } = await supabase.rpc("set_weight_settings", { p_body: body });
  if (error) throw mapMenuDbError(error);
  return setWeightSettingsOutput.parse(data);
}
