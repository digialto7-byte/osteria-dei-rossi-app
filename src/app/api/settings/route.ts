import { withApi } from "@/lib/api/with-api";
import { settingsPatchBody } from "@/server/costing/schemas";
import { getCostSettings, updateCostSettings } from "@/server/costing/settings";

// The three cost rules (average length, alert threshold, sale VAT): owner and admin (Q10).
export const GET = withApi({ roles: ["owner", "admin"] }, async ({ supabase }) =>
  Response.json(await getCostSettings(supabase)),
);

export const PATCH = withApi(
  { roles: ["owner", "admin"], body: settingsPatchBody },
  async ({ supabase, body }) => Response.json(await updateCostSettings(supabase, body)),
);
