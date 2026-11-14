import { withApi } from "@/lib/api/with-api";
import { parseQuery } from "@/server/counts/schemas";
import { getLotCapture } from "@/server/trace/capture";
import { traceCaptureQuery } from "@/server/trace/schemas";

export const GET = withApi({ roles: ["owner", "admin", "chef"] }, async ({ request, supabase }) => {
  const query = parseQuery(traceCaptureQuery, new URL(request.url));
  return Response.json(await getLotCapture(supabase, query));
});
