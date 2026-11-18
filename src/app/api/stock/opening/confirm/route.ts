import { withApi } from "@/lib/api/with-api";
import { confirmOpening } from "@/server/opening/confirm";
import { MAX_OPENING_BODY_BYTES } from "@/server/opening/constants";
import { confirmBody } from "@/server/opening/schemas";

// Opening stock (plan 2026-11-18 §3.9): books one location's draft; owner and admin only. 201 when booked, 200 on a replay.
export const POST = withApi(
  { roles: ["owner", "admin"], body: confirmBody, maxBodyBytes: MAX_OPENING_BODY_BYTES },
  async ({ supabase, body }) => {
    const result = await confirmOpening(supabase, body);
    return Response.json(result, { status: result.changed ? 201 : 200 });
  },
);
