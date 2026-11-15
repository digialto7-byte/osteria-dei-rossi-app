import { withApi } from "@/lib/api/with-api";
import {
  accountMfaCodeRequestSchema,
  accountMfaCodeResponseSchema,
  accountMfaGetResponseSchema,
} from "@/lib/platform/api";
import { challengeAccount, getAccountMfa } from "@/server/auth/account-mfa";

// SP3 step 9 (plan 3.4.3): the second factor of platform staff, who have no venue membership. Access `authenticated`: no tenant claim is needed and the MFA gate is not asked
// (this is the way to aal2). The platform_mfa_* procedures decide who may call it: anyone who is not active platform staff gets 403 forbidden.
export const GET = withApi({ authenticated: true }, async ({ supabase }) =>
  Response.json(accountMfaGetResponseSchema.parse(await getAccountMfa(supabase))),
);

// The sign-in code. A wrong code is recorded for the lock in Postgres; the lock is checked before any Auth call.
export const POST = withApi(
  { authenticated: true, body: accountMfaCodeRequestSchema },
  async ({ supabase, body }) =>
    Response.json(accountMfaCodeResponseSchema.parse(await challengeAccount(supabase, body))),
);
