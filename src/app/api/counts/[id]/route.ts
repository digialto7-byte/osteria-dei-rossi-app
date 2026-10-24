import { withApi } from "@/lib/api/with-api";
import { idParams } from "@/server/counts/schemas";
import { getCount } from "@/server/counts/sessions";

export const GET = withApi(
  { roles: ["owner", "admin", "chef"], params: idParams },
  async ({ supabase, params }) => Response.json(await getCount(supabase, params.id)),
);
