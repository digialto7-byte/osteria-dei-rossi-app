import { withApi } from "@/lib/api/with-api";
import { createDiningTable, listDiningTables } from "@/server/tables/config";
import { MAX_TABLES_BODY_BYTES } from "@/server/tables/constants";
import { createDiningTableBody } from "@/server/tables/schemas";

const MANAGERS = ["owner", "admin"] as const;

export const GET = withApi({ roles: MANAGERS }, async ({ supabase }) =>
  Response.json(await listDiningTables(supabase)),
);

export const POST = withApi(
  { roles: MANAGERS, body: createDiningTableBody, maxBodyBytes: MAX_TABLES_BODY_BYTES },
  async ({ supabase, body }) =>
    Response.json(await createDiningTable(supabase, body), { status: 201 }),
);
