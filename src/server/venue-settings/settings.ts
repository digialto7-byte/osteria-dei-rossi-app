import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { venueSettingsSchema } from "@/lib/venue/settings";
import { mapVenueSettingsDbError } from "./errors";
import type { VenueSettingsPatch } from "./schemas";

/** What set_tenant_settings answers: the settings as /api/me has them plus the sale VAT list, which only owner and admin ever get. */
export const venueSettingsChangeOutput = z.strictObject({
  changed: z.boolean(),
  settings: venueSettingsSchema.extend({ saleVatRates: z.array(z.number()).min(1) }),
});

/** PATCH /api/settings/venue: one transaction in the database, no write before the checks. */
export async function setVenueSettings(supabase: SupabaseClient, body: VenueSettingsPatch) {
  const { data, error } = await supabase.rpc("set_tenant_settings", { p_patch: body });
  if (error) throw mapVenueSettingsDbError(error);
  return venueSettingsChangeOutput.parse(data);
}
