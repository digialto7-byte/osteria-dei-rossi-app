import { withApi } from "@/lib/api/with-api";
import { idParams } from "@/server/master/schemas";
import { getBatchTrace } from "@/server/trace/batch";

export const GET = withApi(
  { roles: ["owner", "admin", "chef"], params: idParams },
  async ({ supabase, session, params }) =>
    Response.json(await getBatchTrace(supabase, session.role, params.id)),
);
