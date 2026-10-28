import type { SupabaseClient } from "@supabase/supabase-js";
import { mapDemoDbError } from "./errors";

/**
 * Deletes every row of the signed-in owner's tenant, if and only if it is the demo tenant and the typed name matches
 * (both checked again in Postgres). Uses the caller's own session client: the secret key never reaches this route.
 * The Auth users and Storage objects of the demo are removed afterwards by DigiAlto's script (ADR-018).
 */
export async function purgeDemoTenant(
  supabase: SupabaseClient,
  confirmName: string,
): Promise<void> {
  const { error } = await supabase.rpc("purge_demo_tenant", { p_confirm_name: confirmName });
  if (error) throw mapDemoDbError(error);
}
