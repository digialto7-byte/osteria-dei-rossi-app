import { withApi } from "@/lib/api/with-api";
import { startEnrolment } from "@/server/auth/mfa";
import { enrolBody, enrolOutput } from "@/server/auth/mfa-schemas";

// P2-1: start the enrolment of the main or the backup authenticator. The secret and the QR image are in this reply only, once (never stored or logged).
export const POST = withApi(
  { roles: ["owner", "admin"], mfa: "exempt", body: enrolBody },
  async ({ supabase, body }) =>
    Response.json(enrolOutput.parse(await startEnrolment(supabase, body.slot)), { status: 201 }),
);
