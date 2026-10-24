import { withApi } from "@/lib/api/with-api";
import { MAX_COUNT_BODY_BYTES } from "@/server/counts/constants";
import { countStartBody, parseCountsQuery } from "@/server/counts/schemas";
import { listCounts, startCount } from "@/server/counts/sessions";

// Owner, admin and chef count (Q1 = owner+chef+admin write stock, founder 2026-10-23); the waiter is refused.
export const GET = withApi({ roles: ["owner", "admin", "chef"] }, async ({ request, supabase }) =>
  Response.json(await listCounts(supabase, parseCountsQuery(new URL(request.url)))),
);

export const POST = withApi(
  { roles: ["owner", "admin", "chef"], body: countStartBody, maxBodyBytes: MAX_COUNT_BODY_BYTES },
  async ({ supabase, body }) => {
    const session = await startCount(supabase, body);
    // 201 for a new count, 200 when the open count of the same type was resumed.
    return Response.json(session, { status: session.resumed ? 200 : 201 });
  },
);
