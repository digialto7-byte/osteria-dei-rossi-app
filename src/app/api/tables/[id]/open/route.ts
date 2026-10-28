import { withApi } from "@/lib/api/with-api";
import { MAX_TABLES_BODY_BYTES } from "@/server/tables/constants";
import { openTable } from "@/server/tables/open";
import { idParams, openTableBody } from "@/server/tables/schemas";

// 201 for a new session, 200 for a replay of the same session id (idempotent, M20).
export const POST = withApi(
  {
    roles: ["owner", "admin", "waiter"],
    params: idParams,
    body: openTableBody,
    maxBodyBytes: MAX_TABLES_BODY_BYTES,
  },
  async ({ supabase, params, body }) => {
    const result = await openTable(supabase, params.id, body);
    return Response.json(result, { status: result.created ? 201 : 200 });
  },
);
