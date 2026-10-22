import { withApi } from "@/lib/api/with-api";
import { unsplitLine } from "@/server/invoices/review-actions";
import { emptyBody, lineParams } from "@/server/invoices/review-schemas";

export const POST = withApi(
  { roles: ["owner", "admin"], params: lineParams, body: emptyBody },
  async ({ supabase, params }) =>
    Response.json({ review: await unsplitLine(supabase, params.id, params.lineId) }),
);
