import { withApi } from "@/lib/api/with-api";
import { createInvoiceFileUrl } from "@/server/invoices/invoices";
import { idParams } from "@/server/master/schemas";

export const GET = withApi(
  { roles: ["owner", "admin"], params: idParams },
  async ({ supabase, params }) => Response.json(await createInvoiceFileUrl(supabase, params.id)),
);
