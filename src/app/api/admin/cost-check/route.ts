import { withApi } from "@/lib/api/with-api";
import { MAX_COST_CHECK_BODY_BYTES } from "@/server/costing/constants";
import { runCostCheck } from "@/server/costing/cost-check-run";
import { costCheckBody } from "@/server/costing/schemas";

// Gate 1: the admin (DigiAlto support) and the owner compare the chef's sheet with the app. Nothing is stored.
export const POST = withApi(
  { roles: ["owner", "admin"], body: costCheckBody, maxBodyBytes: MAX_COST_CHECK_BODY_BYTES },
  async ({ supabase, body }) => Response.json(await runCostCheck(supabase, body)),
);
