import { withApi } from "@/lib/api/with-api";
import { weightSettingsBody } from "@/server/menu/schemas";
import { readWeightSettings, setWeightSettings } from "@/server/menu/weight-settings";
import { MAX_TABLES_BODY_BYTES } from "@/server/tables/constants";

const MANAGERS = ["owner", "admin"] as const;

export const GET = withApi({ roles: MANAGERS }, async ({ supabase }) =>
  Response.json(await readWeightSettings(supabase)),
);

export const PUT = withApi(
  { roles: MANAGERS, body: weightSettingsBody, maxBodyBytes: MAX_TABLES_BODY_BYTES },
  async ({ supabase, body }) => Response.json(await setWeightSettings(supabase, body)),
);
