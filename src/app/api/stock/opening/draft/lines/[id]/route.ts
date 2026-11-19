import { withApi } from "@/lib/api/with-api";
import { removeOpeningDraftLine } from "@/server/opening/draft";
import { idParams } from "@/server/opening/schemas";

// Opening stock (plan 2026-11-18 §3.9): removes one draft line; owner and admin only.
export const DELETE = withApi(
  { roles: ["owner", "admin"], params: idParams },
  async ({ supabase, params }) => Response.json(await removeOpeningDraftLine(supabase, params.id)),
);
