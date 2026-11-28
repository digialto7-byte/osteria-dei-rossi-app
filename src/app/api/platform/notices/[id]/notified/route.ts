import { withApi } from "@/lib/api/with-api";
import { noticeNotifiedRequestSchema, noticeNotifiedResponseSchema } from "@/lib/platform/api";
import { dbNoticeMark, platformIdParams } from "@/server/platform/output";
import { callPlatform } from "@/server/platform/rpc";

// SP3 step 17 (plan §3.4.5, AT9): "Segna come avvisato". One notice.tenant_notified row, unless one exists (changed: false).
export const POST = withApi(
  { platform: true, params: platformIdParams, body: noticeNotifiedRequestSchema },
  async ({ supabase, params, body }) =>
    Response.json(
      noticeNotifiedResponseSchema.parse(
        await callPlatform(
          supabase,
          "platform_notice_mark",
          { p_notice: params.id, p_tenant: body.tenantId },
          dbNoticeMark,
        ),
      ),
    ),
);
