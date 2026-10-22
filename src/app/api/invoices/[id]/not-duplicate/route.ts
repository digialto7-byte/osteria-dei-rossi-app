import { withApi } from "@/lib/api/with-api";
import { clearDuplicate } from "@/server/invoices/review-actions";
import { notDuplicateBody } from "@/server/invoices/review-schemas";
import { idParams } from "@/server/master/schemas";

export const POST = withApi(
  { roles: ["owner", "admin"], params: idParams, body: notDuplicateBody },
  async ({ supabase, params, body }) =>
    Response.json({ review: await clearDuplicate(supabase, params.id, body.partnerId) }),
);
