import type { SupabaseClient } from "@supabase/supabase-js";
import { mapServicesDbError } from "./errors";
import { servicePeriodsOutput, setServicePeriodsOutput } from "./output";
import type { ServicesBody } from "./schemas";

/** GET /api/settings/services: the periods in force (the built-in default when the owner never saved), with each service's end and the cut-off. */
export async function readServices(supabase: SupabaseClient) {
  const { data, error } = await supabase.rpc("service_periods");
  if (error) throw mapServicesDbError(error);
  return servicePeriodsOutput.parse(data);
}

/**
 * PATCH /api/settings/services: the whole list. A change applies to tables opened from now on; the past never moves. An identical list changes
 * nothing (`changed: false`).
 */
export async function saveServices(supabase: SupabaseClient, body: ServicesBody) {
  const { data, error } = await supabase.rpc("set_service_periods", { p_body: body });
  if (error) throw mapServicesDbError(error);
  return setServicePeriodsOutput.parse(data);
}
