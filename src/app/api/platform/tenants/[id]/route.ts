import { withApi } from "@/lib/api/with-api";
import { tenantDetailResponseSchema } from "@/lib/platform/api";
import { dbTenant, platformIdParams } from "@/server/platform/output";
import { callPlatform } from "@/server/platform/rpc";

// SP3 step 17 (plan §3.4.5): one venue and its last ten platform audit rows.
export const GET = withApi(
  { platform: true, params: platformIdParams },
  async ({ supabase, params }) =>
    Response.json(
      tenantDetailResponseSchema.parse(
        await callPlatform(supabase, "platform_tenant", { p_tenant: params.id }, dbTenant),
      ),
    ),
);
