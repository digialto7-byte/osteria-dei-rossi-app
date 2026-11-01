import { withApi } from "@/lib/api/with-api";
import { passwordSignIn } from "@/server/auth/password-sign-in";
import { passwordSignInBody } from "@/server/auth/schemas";

// Public: the person is not signed in yet. Supabase Auth checks the credentials and its own rate limits;
// the access-token hook decides the claims (a PIN account gets no tenant from it, ADR-010).
export const POST = withApi(
  { public: true, body: passwordSignInBody },
  async ({ supabase, body }) => Response.json(await passwordSignIn(supabase, body)),
);
