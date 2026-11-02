import { withApi } from "@/lib/api/with-api";
import { emailCodeSignIn } from "@/server/auth/email-code";
import { withMinDuration } from "@/server/auth/min-duration";
import { emailCodeBody } from "@/server/auth/schemas";

// Public: the person is not signed in yet. JSON-only (withApi), so a cross-site form cannot post a code.
// Every answer takes at least the same time (ADR-029, "Timing").
export const POST = withMinDuration(
  withApi({ public: true, body: emailCodeBody }, async ({ supabase, body }) =>
    Response.json(await emailCodeSignIn(supabase, body)),
  ),
);
