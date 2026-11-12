import { withApi } from "@/lib/api/with-api";
import { verifyEnrolment } from "@/server/auth/mfa";
import { codeBody, factorParams, verifyOutput } from "@/server/auth/mfa-schemas";

// P2-1: finish the enrolment with the first code from the new authenticator.
export const POST = withApi(
  { roles: ["owner", "admin"], mfa: "exempt", params: factorParams, body: codeBody },
  async ({ supabase, params, body }) =>
    Response.json(verifyOutput.parse(await verifyEnrolment(supabase, params.id, body.code))),
);
