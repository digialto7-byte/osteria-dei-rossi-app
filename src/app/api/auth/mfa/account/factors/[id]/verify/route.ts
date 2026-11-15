import { z } from "zod";
import { withApi } from "@/lib/api/with-api";
import { accountMfaVerifyRequestSchema, accountMfaVerifyResponseSchema } from "@/lib/platform/api";
import { verifyAccountEnrolment } from "@/server/auth/account-mfa";

// SP3 step 9 (plan 3.4.3): finish the enrolment with the first code from the new authenticator. The session becomes aal2.
export const POST = withApi(
  {
    authenticated: true,
    params: z.object({ id: z.uuid() }),
    body: accountMfaVerifyRequestSchema,
  },
  async ({ supabase, params, body }) =>
    Response.json(
      accountMfaVerifyResponseSchema.parse(
        await verifyAccountEnrolment(supabase, params.id, body.code),
      ),
    ),
);
