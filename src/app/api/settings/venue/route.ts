import { withApi } from "@/lib/api/with-api";
import { MAX_MENU_BODY_BYTES } from "@/server/menu/constants";
import { venueSettingsPatch } from "@/server/venue-settings/schemas";
import { setVenueSettings } from "@/server/venue-settings/settings";

// Owner and admin only (the database repeats the check). Not offline-cacheable: it never imports lib/api/offline-cache.
export const PATCH = withApi(
  { roles: ["owner", "admin"], body: venueSettingsPatch, maxBodyBytes: MAX_MENU_BODY_BYTES },
  async ({ supabase, body }) => Response.json(await setVenueSettings(supabase, body)),
);
