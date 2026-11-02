import { withApi } from "@/lib/api/with-api";
import { passwordSignIn } from "@/server/auth/password-sign-in";
import { withMinDuration } from "@/server/auth/min-duration";
import { passwordSignInBody } from "@/server/auth/schemas";

// Public: the person is not signed in yet. Supabase Auth checks the credentials and its own rate limits;
// the access-token hook decides the claims (a PIN account gets no tenant from it, ADR-010).
// Every answer takes at least the same time, so an unknown address cannot be told from a wrong password (ADR-029).
export const POST = withMinDuration(
  withApi({ public: true, body: passwordSignInBody }, async ({ supabase, body }) =>
    Response.json(await passwordSignIn(supabase, body)),
  ),
);
