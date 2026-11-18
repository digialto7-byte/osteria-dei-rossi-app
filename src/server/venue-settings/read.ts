import type { SupabaseClient } from "@supabase/supabase-js";
import { venueSettingsSchema, type VenueSettings } from "@/lib/venue/settings";

/**
 * The calling tenant's venue settings from public.tenant_settings(). An RPC error is thrown with its code only, and settings that
 * fail the schema are refused: server code never falls back to a default zone (Rule B).
 */
export async function readTenantSettings(supabase: SupabaseClient): Promise<VenueSettings> {
  const { data, error } = await supabase.rpc("tenant_settings");
  if (error) throw new Error(`tenant_settings failed: ${error.code ?? "no code"}`);
  return venueSettingsSchema.parse(data);
}
