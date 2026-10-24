import { withApi } from "@/lib/api/with-api";
import { updateDiningTable } from "@/server/tables/config";
import { MAX_TABLES_BODY_BYTES } from "@/server/tables/constants";
import { idParams, updateDiningTableBody } from "@/server/tables/schemas";

export const PATCH = withApi(
  {
    roles: ["owner", "admin"],
    params: idParams,
    body: updateDiningTableBody,
    maxBodyBytes: MAX_TABLES_BODY_BYTES,
  },
  async ({ supabase, params, body }) =>
    Response.json(await updateDiningTable(supabase, params.id, body)),
);
