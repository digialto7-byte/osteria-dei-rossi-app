import { withApi } from "@/lib/api/with-api";
import { idParams } from "@/server/master/schemas";
import { getLineTrace } from "@/server/trace/lines";

export const GET = withApi(
  { roles: ["owner", "admin", "chef"], params: idParams },
  async ({ supabase, session, params }) =>
    Response.json(await getLineTrace(supabase, session.role, params.id)),
);
