import { withApi } from "@/lib/api/with-api";
import { getInvoice } from "@/server/invoices/invoices";
import { updateHeader } from "@/server/invoices/review-actions";
import { headerPatchBody } from "@/server/invoices/review-schemas";
import { idParams } from "@/server/master/schemas";

export const GET = withApi(
  { roles: ["owner", "admin"], params: idParams },
  async ({ supabase, params }) => Response.json({ invoice: await getInvoice(supabase, params.id) }),
);

export const PATCH = withApi(
  { roles: ["owner", "admin"], params: idParams, body: headerPatchBody },
  async ({ supabase, params, body }) =>
    Response.json({ review: await updateHeader(supabase, params.id, body) }),
);
