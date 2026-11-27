import { z } from "zod";
import { withApi } from "@/lib/api/with-api";
import { switchOutput } from "@/server/tenancy/output";
import { switchTenant } from "@/server/tenancy/switch";

const body = z.strictObject({ tenantId: z.uuid() });

/**
 * Changes the venue this session works in (SP2 plan §3.4). Any signed-in e-mail login with an active membership there; JSON only (CSRF).
 * The response sets the refreshed session cookies; the client then forgets its caches and loads the page again (src/lib/tenancy/switch.ts).
 */
export const POST = withApi({ authenticated: true, body }, async ({ supabase, session, body }) =>
  Response.json(switchOutput.parse(await switchTenant(supabase, session, body.tenantId))),
);
