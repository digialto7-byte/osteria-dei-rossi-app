import { withApi } from "@/lib/api/with-api";
import { getOpeningHistory } from "@/server/opening/history";
import { locationQuery } from "@/server/opening/schemas";

// Opening stock (plan 2026-11-18 §3.9): the operations of one location; owner and admin only.
export const GET = withApi({ roles: ["owner", "admin"] }, async ({ supabase, request }) =>
  Response.json(await getOpeningHistory(supabase, locationQuery(new URL(request.url)).locationId)),
);
