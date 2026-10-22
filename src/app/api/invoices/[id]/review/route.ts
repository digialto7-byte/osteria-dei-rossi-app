import { withApi } from "@/lib/api/with-api";
import { loadInvoiceReview } from "@/server/invoices/review";
import { idParams } from "@/server/master/schemas";

export const GET = withApi(
  { roles: ["owner", "admin"], params: idParams },
  async ({ supabase, params }) =>
    Response.json({ review: await loadInvoiceReview(supabase, params.id) }),
);
