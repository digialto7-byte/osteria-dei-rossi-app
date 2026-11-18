import { withApi } from "@/lib/api/with-api";
import { parseLocaleQuery } from "@/server/alerts/list";
import { raiseTestAlert, testAlertBody } from "@/server/alerts/test";

export const POST = withApi(
  { roles: ["owner"], body: testAlertBody },
  async ({ request, supabase, session, body, tenantSettings }) => {
    const result = await raiseTestAlert(
      supabase,
      body,
      session.role,
      parseLocaleQuery(new URL(request.url)),
      (await tenantSettings()).timeZone,
    );
    return Response.json(result, { status: result.deduplicated ? 200 : 201 });
  },
);
