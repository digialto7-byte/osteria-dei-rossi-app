import { withApi } from "@/lib/api/with-api";
import { getMfaStatus } from "@/server/auth/mfa";
import { mfaStatusOutput } from "@/server/auth/mfa-schemas";

// P2-1: the account's own second-factor state. Exempt from the gate (T-4): it must answer while the account is still at aal1.
export const GET = withApi({ roles: ["owner", "admin"], mfa: "exempt" }, async ({ supabase }) =>
  Response.json(mfaStatusOutput.parse(await getMfaStatus(supabase))),
);
