import { ApiError } from "@/lib/api/errors";
import { withApi } from "@/lib/api/with-api";
import { auditQuerySchema, auditResponseSchema } from "@/lib/platform/api";
import { dbAudit } from "@/server/platform/output";
import { callPlatform } from "@/server/platform/rpc";

// SP3 step 17 (plan §3.4.5): the Registro. dal and al are required Europe/Rome days, at most 366 apart; 50 rows per page, fixed. A repeated or unknown
// parameter is refused (400), never guessed.
function readQuery(request: Request) {
  const params = new URL(request.url).searchParams;
  const keys = [...params.keys()];
  if (new Set(keys).size !== keys.length) {
    throw new ApiError(400, "invalid_request", "Parametri ripetuti.");
  }
  const parsed = auditQuerySchema.safeParse(Object.fromEntries(params));
  if (!parsed.success) throw new ApiError(400, "invalid_request", "Parametri non validi.");
  return parsed.data;
}

export const GET = withApi({ platform: true }, async ({ supabase, request }) => {
  const query = readQuery(request);
  const page = await callPlatform(
    supabase,
    "platform_audit",
    {
      p_from: query.dal,
      p_to: query.al,
      p_tenant: query.locale ?? null,
      p_action: query.azione ?? null,
      p_before: query.prima ?? null,
    },
    dbAudit,
  );
  return Response.json(auditResponseSchema.parse(page));
});
