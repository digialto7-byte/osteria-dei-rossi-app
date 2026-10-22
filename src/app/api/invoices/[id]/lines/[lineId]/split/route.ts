import { withApi } from "@/lib/api/with-api";
import { splitLine } from "@/server/invoices/review-actions";
import { lineParams, splitBody } from "@/server/invoices/review-schemas";

export const POST = withApi(
  { roles: ["owner", "admin"], params: lineParams, body: splitBody },
  async ({ supabase, params, body }) =>
    Response.json({ review: await splitLine(supabase, params.id, params.lineId, body) }),
);
