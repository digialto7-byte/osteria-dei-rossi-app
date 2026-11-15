import { withApi } from "@/lib/api/with-api";
import { accountMfaEnrolRequestSchema, accountMfaEnrolResponseSchema } from "@/lib/platform/api";
import { startAccountEnrolment } from "@/server/auth/account-mfa";

// SP3 step 9 (plan 3.4.3): start the enrolment of the main or the backup authenticator for platform staff. The setup key and the QR image are in this reply only, once (never
// stored or logged). A second factor needs aal2 (mfa_required).
export const POST = withApi(
  { authenticated: true, body: accountMfaEnrolRequestSchema },
  async ({ supabase, body }) =>
    Response.json(
      accountMfaEnrolResponseSchema.parse(await startAccountEnrolment(supabase, body.slot)),
    ),
);
