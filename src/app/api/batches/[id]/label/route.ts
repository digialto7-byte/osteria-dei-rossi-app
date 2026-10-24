import { withApi } from "@/lib/api/with-api";
import { getLabel } from "@/server/batches/label";
import { idParams } from "@/server/batches/schemas";

export const GET = withApi(
  { roles: ["owner", "admin", "chef"], params: idParams },
  async ({ supabase, params }) => Response.json(await getLabel(supabase, params.id)),
);
