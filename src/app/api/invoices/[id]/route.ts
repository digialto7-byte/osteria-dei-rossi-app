import { withApi } from "@/lib/api/with-api";
import { getInvoice } from "@/server/invoices/invoices";
import { idParams } from "@/server/master/schemas";

export const GET = withApi(
  { roles: ["owner", "admin"], params: idParams },
  async ({ supabase, params }) => Response.json({ invoice: await getInvoice(supabase, params.id) }),
);
