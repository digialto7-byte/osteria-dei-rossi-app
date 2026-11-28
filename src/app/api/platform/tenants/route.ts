import { withApi } from "@/lib/api/with-api";
import { tenantsResponseSchema } from "@/lib/platform/api";
import { dbTenants } from "@/server/platform/output";
import { callPlatform } from "@/server/platform/rpc";

// SP3 step 17 (plan §3.4.5): Locali. Metadata only (AT5): no money, no person, no address.
export const GET = withApi({ platform: true }, async ({ supabase }) =>
  Response.json(
    tenantsResponseSchema.parse({
      tenants: await callPlatform(supabase, "platform_tenants", undefined, dbTenants),
    }),
  ),
);
