import { withApi } from "@/lib/api/with-api";
import { approveBody } from "@/server/invoices/approval-schemas";
import { approveInvoice } from "@/server/invoices/approval";
import { idParams } from "@/server/master/schemas";

export const POST = withApi(
  { roles: ["owner", "admin"], params: idParams, body: approveBody },
  async ({ supabase, params, body }) =>
    Response.json(await approveInvoice(supabase, params.id, body)),
);
