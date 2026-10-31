import { withApi } from "@/lib/api/with-api";
import { parseQuery } from "@/server/counts/schemas";
import { measured, timedJson } from "@/server/orders/timing";
import { getKpiItems } from "@/server/reports/items";
import { periodQuery } from "@/server/reports/schemas";

// Owner and admin only. The owner's rows add the fixed-cost keys (Q107); the reply is parsed with the schema of the caller's role.
export const GET = withApi(
  { roles: ["owner", "admin"] },
  async ({ request, supabase, session, timing }) => {
    const query = parseQuery(periodQuery, new URL(request.url));
    const { result, header } = await measured(timing, () =>
      getKpiItems(supabase, session.role, query),
    );
    return timedJson(result, header);
  },
);
