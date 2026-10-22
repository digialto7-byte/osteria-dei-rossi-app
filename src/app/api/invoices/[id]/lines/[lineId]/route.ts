import { withApi } from "@/lib/api/with-api";
import { updateLine } from "@/server/invoices/review-actions";
import { lineParams, linePatchBody } from "@/server/invoices/review-schemas";

export const PATCH = withApi(
  { roles: ["owner", "admin"], params: lineParams, body: linePatchBody },
  async ({ supabase, params, body }) =>
    Response.json({ review: await updateLine(supabase, params.id, params.lineId, body) }),
);
