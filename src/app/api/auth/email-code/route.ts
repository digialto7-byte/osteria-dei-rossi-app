import { withApi } from "@/lib/api/with-api";
import { emailCodeSignIn } from "@/server/auth/email-code";
import { emailCodeBody } from "@/server/auth/schemas";

// Public: the person is not signed in yet. JSON-only (withApi), so a cross-site form cannot post a code.
export const POST = withApi({ public: true, body: emailCodeBody }, async ({ supabase, body }) =>
  Response.json(await emailCodeSignIn(supabase, body)),
);
