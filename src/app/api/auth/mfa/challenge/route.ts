import { withApi } from "@/lib/api/with-api";
import { challengeSignIn } from "@/server/auth/mfa";
import { challengeBody, challengeOutput } from "@/server/auth/mfa-schemas";

// P2-1: the code after the password or e-mail code. The person is signed in at aal1, so this route is exempt from the gate (T-4).
export const POST = withApi(
  { roles: ["owner", "admin"], mfa: "exempt", body: challengeBody },
  async ({ supabase, session, body }) =>
    Response.json(challengeOutput.parse(await challengeSignIn(supabase, session, body))),
);
