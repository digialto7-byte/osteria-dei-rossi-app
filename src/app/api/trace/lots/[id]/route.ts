import { withApi } from "@/lib/api/with-api";
import { idParams } from "@/server/master/schemas";
import { getLotTrace } from "@/server/trace/forward";

// The owner's and admin's reply carries the invoice and the purchase line, the chef's cannot (strict schema per role).
export const GET = withApi(
  { roles: ["owner", "admin", "chef"], params: idParams },
  async ({ supabase, session, params }) =>
    Response.json(await getLotTrace(supabase, session.role, params.id)),
);
