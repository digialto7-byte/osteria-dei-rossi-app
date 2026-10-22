import { withApi } from "@/lib/api/with-api";
import { setSupplier } from "@/server/invoices/review-actions";
import { supplierBody } from "@/server/invoices/review-schemas";
import { idParams } from "@/server/master/schemas";

export const POST = withApi(
  { roles: ["owner", "admin"], params: idParams, body: supplierBody },
  async ({ supabase, params, body }) =>
    Response.json({ review: await setSupplier(supabase, params.id, body) }),
);
