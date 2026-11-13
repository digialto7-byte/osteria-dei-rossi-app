import { withApi } from "@/lib/api/with-api";
import { listAccounts } from "@/server/auth/mfa";

// P2-1 (Q-T1 = V1): the other owner and admin accounts and how many verified devices each has. Read-only, and gated like every other owner route: there is no reset in the app.
export const GET = withApi({ roles: ["owner", "admin"] }, async ({ supabase }) =>
  Response.json(await listAccounts(supabase)),
);
