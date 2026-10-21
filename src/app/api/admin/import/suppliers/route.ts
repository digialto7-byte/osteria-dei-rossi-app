import { withApi } from "@/lib/api/with-api";
import { importBody, importMasterData, MAX_IMPORT_BODY_BYTES } from "@/server/master/import";

export const POST = withApi(
  { roles: ["owner", "admin"], body: importBody, maxBodyBytes: MAX_IMPORT_BODY_BYTES },
  async ({ supabase, body }) => Response.json(await importMasterData(supabase, "suppliers", body)),
);
