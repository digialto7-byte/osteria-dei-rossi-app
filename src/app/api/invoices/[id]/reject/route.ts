import { withApi } from "@/lib/api/with-api";
import { rejectBody } from "@/server/invoices/approval-schemas";
import { rejectInvoice } from "@/server/invoices/approval";
import { idParams } from "@/server/master/schemas";

export const POST = withApi(
  { roles: ["owner", "admin"], params: idParams, body: rejectBody },
  async ({ supabase, params, body }) =>
    Response.json(await rejectInvoice(supabase, params.id, body)),
);
