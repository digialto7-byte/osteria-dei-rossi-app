import { ApiError } from "@/lib/api/errors";
import { withApi } from "@/lib/api/with-api";
import { findExport } from "@/server/exports/registry";
import { csvResponse } from "@/server/exports/respond";
import { exportParams } from "@/server/exports/schemas";
import { measured } from "@/server/orders/timing";

// GET /api/exports/<slug>.csv (M24, ADR-027): the CSV of one report table, built from the same query schema and the same service as the JSON route of
// that report. Owner and admin only: the chef and the waiter get 403 before any RPC, even for the tables the chef reads as JSON. Errors stay JSON
// with the JSON route's own status. `monthly-pack` is a static sibling segment and wins over this one.
export const GET = withApi(
  { roles: ["owner", "admin"], params: exportParams },
  async ({ request, supabase, session, params, timing }) => {
    const table = findExport(params.file.slice(0, -".csv".length));
    if (!table) throw new ApiError(404, "not_found", "Risorsa non trovata.");
    const query = table.parse(new URL(request.url));
    const { result, header } = await measured(timing, () => table.load(supabase, session, query));
    // The route admits owner and admin only; anything else would get the narrower (admin) columns.
    return csvResponse(table, result, session.role === "owner" ? "owner" : "admin", header);
  },
);
