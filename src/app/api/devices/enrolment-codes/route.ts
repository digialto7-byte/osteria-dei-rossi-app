import { withApi } from "@/lib/api/with-api";
import { createEnrolmentCode } from "@/server/staff-auth/devices";
import { enrolmentCodeBody } from "@/server/staff-auth/schemas";

// The plain code is in this response only; the database holds its SHA-256.
export const POST = withApi(
  { roles: ["owner", "admin"], body: enrolmentCodeBody },
  async ({ supabase, body }) =>
    Response.json(await createEnrolmentCode(supabase, body.label), {
      status: 201,
      headers: { "cache-control": "no-store" },
    }),
);
