import { withApi } from "@/lib/api/with-api";
import { replaceWithXml } from "@/server/invoices/review-actions";
import { useXmlBody } from "@/server/invoices/review-schemas";
import { idParams } from "@/server/master/schemas";

export const POST = withApi(
  { roles: ["owner", "admin"], params: idParams, body: useXmlBody },
  async ({ supabase, params, body }) =>
    Response.json(await replaceWithXml(supabase, params.id, body.replaces)),
);
