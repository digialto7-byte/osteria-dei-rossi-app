import { withApi } from "@/lib/api/with-api";
import { idParams } from "@/server/payables/schemas";
import { getSupplierStatement } from "@/server/payables/statement";

export const GET = withApi(
  { roles: ["owner", "admin"], params: idParams },
  async ({ supabase, params }) => Response.json(await getSupplierStatement(supabase, params.id)),
);
