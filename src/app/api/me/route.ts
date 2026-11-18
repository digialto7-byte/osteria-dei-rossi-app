import { z } from "zod";
import { ApiError } from "@/lib/api/errors";
import { offlineCacheable } from "@/lib/api/offline-cache";
import { APP_ROLES, withApi } from "@/lib/api/with-api";
import { meOutput } from "@/server/me/output";

const meRow = z.object({
  id: z.uuid(),
  display_name: z.string(),
  role: z.enum(APP_ROLES),
  tenant: z.object({ id: z.uuid(), name: z.string(), demo_data_since: z.string().nullable() }),
});

export const GET = withApi({ roles: APP_ROLES }, async ({ supabase, session }) => {
  const { data, error } = await supabase
    .from("app_user")
    .select("id, display_name, role, tenant:tenant_id (id, name, demo_data_since)")
    .eq("auth_id", session.authId)
    .maybeSingle();
  if (error) throw error;
  // RLS hides a row deactivated after the token was issued; treat it like no membership.
  if (!data)
    throw new ApiError(403, "no_tenant", "Questo account non è abilitato per nessun locale.");

  const row = meRow.parse(data);
  // The tenant's venue settings (zone, locale, currency, receipt and payment codes). An RPC error is reported with its
  // code only; settings that do not match the strict output are refused (500), never replaced by a default.
  const { data: settings, error: settingsError } = await supabase.rpc("tenant_settings");
  if (settingsError) throw new Error(`tenant_settings failed: ${settingsError.code ?? "no code"}`);
  // The role in the row just read (not the token's claim, which can be older) decides whether the worker may store this answer.
  return offlineCacheable(
    Response.json(
      meOutput.parse({
        user: { id: row.id, displayName: row.display_name, role: row.role },
        tenant: {
          id: row.tenant.id,
          name: row.tenant.name,
          isDemo: row.tenant.demo_data_since !== null,
        },
        settings,
      }),
    ),
    row.role,
  );
});
