import { z } from "zod";
import { withApi } from "@/lib/api/with-api";
import { acknowledgeAlert } from "@/server/alerts/ack";
import { parseLocaleQuery } from "@/server/alerts/list";
import { idParams } from "@/server/master/schemas";

export const POST = withApi(
  { roles: ["owner", "chef"], params: idParams, body: z.object({}) },
  async ({ request, supabase, session, params }) =>
    Response.json({
      alert: await acknowledgeAlert(
        supabase,
        params.id,
        session.role,
        parseLocaleQuery(new URL(request.url)),
      ),
    }),
);
