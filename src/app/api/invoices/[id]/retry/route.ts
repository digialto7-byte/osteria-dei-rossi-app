import { withApi } from "@/lib/api/with-api";
import { retryExtraction } from "@/server/invoices/review-actions";
import { emptyBody } from "@/server/invoices/review-schemas";
import { idParams } from "@/server/master/schemas";

export const POST = withApi(
  { roles: ["owner", "admin"], params: idParams, body: emptyBody },
  async ({ supabase, params }) =>
    Response.json({ invoice: await retryExtraction(supabase, params.id) }, { status: 202 }),
);
