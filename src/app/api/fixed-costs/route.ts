import { withApi } from "@/lib/api/with-api";
import { enterFixedCosts, listFixedCosts } from "@/server/costing/fixed-costs";
import { fixedCostBody } from "@/server/costing/schemas";

// Fixed costs are owner only, read and write (founder 2026-10-23): a labour total can reveal a salary.
export const GET = withApi({ roles: ["owner"] }, async ({ supabase }) =>
  Response.json(await listFixedCosts(supabase)),
);

export const POST = withApi(
  { roles: ["owner"], body: fixedCostBody },
  async ({ supabase, body }) => {
    const { created, period } = await enterFixedCosts(supabase, body);
    return Response.json({ period }, { status: created ? 201 : 200 });
  },
);
