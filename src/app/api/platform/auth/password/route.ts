import { withApi } from "@/lib/api/with-api";
import { passwordSignInRequestSchema, passwordSignInResponseSchema } from "@/lib/platform/api";
import { withMinDuration } from "@/server/auth/min-duration";
import { consoleSignIn } from "@/server/platform/sign-in";

// SP3 step 17 (plan §3.4.4): the console's password sign-in. Public: the person is not signed in yet. Every answer takes at least the same time, so an unknown
// address cannot be told from a wrong password (ADR-029). An account that is not platform staff is signed out at once (403 not_console_account).
export const POST = withMinDuration(
  withApi({ public: true, body: passwordSignInRequestSchema }, async ({ supabase, body }) =>
    Response.json(passwordSignInResponseSchema.parse(await consoleSignIn(supabase, body))),
  ),
);
