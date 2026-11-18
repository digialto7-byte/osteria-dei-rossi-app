import { withApi } from "@/lib/api/with-api";
import { clearOpeningDraft, getOpeningDraft } from "@/server/opening/draft";
import { locationQuery } from "@/server/opening/schemas";

// Opening stock (plan 2026-11-18 §3.9): owner and admin only (the carico sets costs); roles are also enforced in Postgres.
export const GET = withApi({ roles: ["owner", "admin"] }, async ({ supabase }) =>
  Response.json(await getOpeningDraft(supabase)),
);

export const DELETE = withApi({ roles: ["owner", "admin"] }, async ({ supabase, request }) =>
  Response.json(await clearOpeningDraft(supabase, locationQuery(new URL(request.url)).locationId)),
);
