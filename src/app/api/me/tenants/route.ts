import { withApi } from "@/lib/api/with-api";
import { readMemberships } from "@/server/tenancy/memberships";
import { tenantsOutput } from "@/server/tenancy/output";

/**
 * The login's venues for the chooser and the switcher (SP2 plan §3.4). Any signed-in login: a session without a tenant claim needs it most.
 * `current` marks the token's tenant. Never offline-cached (it is not on OFFLINE_CACHE_PATHS), so a switch can never show a stale list.
 */
export const GET = withApi({ authenticated: true }, async ({ supabase, session }) => {
  const memberships = await readMemberships(supabase);
  return Response.json(
    tenantsOutput.parse({
      tenants: memberships.map((m) => ({
        id: m.tenantId,
        name: m.name,
        role: m.role,
        current: m.tenantId === session.tenantId,
      })),
    }),
  );
});
