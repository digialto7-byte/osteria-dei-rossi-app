import { z } from "zod";
import { APP_ROLES } from "@/lib/api/with-api";

/** One row of public.my_memberships(), strict: an unknown key (a cost, another person) is refused, never passed on. */
export const membershipRow = z.strictObject({
  tenantId: z.uuid(),
  name: z.string(),
  role: z.enum(APP_ROLES),
});
export const membershipRows = z.array(membershipRow);
export type Membership = z.infer<typeof membershipRow>;

/** The reply of GET /api/me/tenants (SP2 plan §3.4). Never offline-cached. */
export const tenantsOutput = z.strictObject({
  tenants: z.array(
    z.strictObject({
      id: z.uuid(),
      name: z.string(),
      role: z.enum(APP_ROLES),
      current: z.boolean(),
    }),
  ),
});
export type TenantsReply = z.infer<typeof tenantsOutput>;

/** The reply of POST /api/me/tenant. */
export const switchOutput = z.strictObject({ tenantId: z.uuid() });
