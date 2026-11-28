import { ApiError } from "@/lib/api/errors";
import { withApi } from "@/lib/api/with-api";
import { readAppOrigin } from "@/lib/env";
import { openTenantResponseSchema } from "@/lib/platform/api";
import { dbOpenTenant, emptyBody, platformIdParams } from "@/server/platform/output";
import { callPlatform } from "@/server/platform/rpc";

// SP3 step 17, 19 (plan §3.4.5, §3.7): "Entra nel locale". platform_open_tenant writes console.tenant_opened when DigiAlto is attached; the reply is the venue app's
// chooser with that venue highlighted (?locale only orders and marks it; nothing switches on load). APP_ORIGIN is checked first, so a misconfigured deployment
// writes no audit row.
export const POST = withApi(
  { platform: true, params: platformIdParams, body: emptyBody },
  async ({ supabase, params }) => {
    const origin = readAppOrigin();
    if (origin === undefined) throw new Error("APP_ORIGIN is not set");
    const opened = await callPlatform(
      supabase,
      "platform_open_tenant",
      { p_tenant: params.id },
      dbOpenTenant,
    );
    if (!opened.attached) {
      throw new ApiError(409, "digialto_not_attached", "DigiAlto non è collegato a questo locale.");
    }
    const url = new URL("/login/scegli-locale", origin);
    url.searchParams.set("locale", opened.tenantId);
    return Response.json(openTenantResponseSchema.parse({ url: url.toString() }));
  },
);
