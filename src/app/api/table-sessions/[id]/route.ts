import { withApi } from "@/lib/api/with-api";
import { MAX_TABLES_BODY_BYTES } from "@/server/tables/constants";
import { idParams, sessionPatchBody } from "@/server/tables/schemas";
import { updateSession } from "@/server/tables/session";

export const PATCH = withApi(
  {
    roles: ["owner", "admin", "waiter"],
    params: idParams,
    body: sessionPatchBody,
    maxBodyBytes: MAX_TABLES_BODY_BYTES,
  },
  async ({ supabase, params, body }) =>
    Response.json(await updateSession(supabase, params.id, body)),
);
