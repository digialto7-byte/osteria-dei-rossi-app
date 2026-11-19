import { ApiError } from "@/lib/api/errors";
import { withApi } from "@/lib/api/with-api";
import { clearOpeningDraft, getOpeningDraft } from "@/server/opening/draft";
import { locationQuery } from "@/server/opening/schemas";

// Opening stock (plan 2026-11-18 §3.9): owner and admin only (the carico sets costs); roles are also enforced in Postgres.
// GET takes no parameters: a query string is a 400 before any query, as on /api/today and /api/dashboard.
export const GET = withApi({ roles: ["owner", "admin"] }, async ({ supabase, request }) => {
  if ([...new URL(request.url).searchParams.keys()].length > 0) {
    throw new ApiError(400, "invalid_request", "Filtri non validi.");
  }
  return Response.json(await getOpeningDraft(supabase));
});

export const DELETE = withApi({ roles: ["owner", "admin"] }, async ({ supabase, request }) =>
  Response.json(await clearOpeningDraft(supabase, locationQuery(new URL(request.url)).locationId)),
);
