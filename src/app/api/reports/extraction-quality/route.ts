import { withApi } from "@/lib/api/with-api";
import {
  getExtractionQuality,
  parseExtractionQualityQuery,
} from "@/server/reports/extraction-quality";

export const GET = withApi({ roles: ["owner", "admin"] }, async ({ request, supabase }) => {
  const query = parseExtractionQualityQuery(new URL(request.url), new Date());
  return Response.json({
    period: { from: query.from, to: query.to },
    report: await getExtractionQuality(supabase, query),
  });
});
