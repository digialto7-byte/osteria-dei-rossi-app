import { withApi } from "@/lib/api/with-api";
import { reverseOpening } from "@/server/opening/reverse";
import { idParams, reverseBody } from "@/server/opening/schemas";

// Opening stock (plan 2026-11-18 §3.9): corrects a whole carico with a reason; owner and admin only.
export const POST = withApi(
  { roles: ["owner", "admin"], body: reverseBody, params: idParams },
  async ({ supabase, body, params }) =>
    Response.json(await reverseOpening(supabase, params.id, body), { status: 201 }),
);
