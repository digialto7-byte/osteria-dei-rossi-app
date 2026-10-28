import type { SupabaseClient } from "@supabase/supabase-js";
import { mapDemoDbError } from "./errors";

/**
 * Resets the operational data of the signed-in owner's tenant, if and only if it carries demo data and the typed name matches
 * (both checked again in Postgres). It keeps the tenant and every non-demo user. Uses the caller's own session client: the
 * secret key never reaches this route. The Auth users and Storage objects of the demo are removed afterwards by DigiAlto's
 * script (ADR-018).
 */
export async function purgeDemoTenant(
  supabase: SupabaseClient,
  confirmName: string,
): Promise<void> {
  const { error } = await supabase.rpc("purge_demo_data", { p_confirm_name: confirmName });
  if (error) throw mapDemoDbError(error);
}
