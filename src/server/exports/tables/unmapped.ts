import { cell } from "@/lib/csv/write";
import { parseQuery } from "@/server/counts/schemas";
import type { UnmappedOutput } from "@/server/reports/output";
import { unmappedQuery, type UnmappedQuery } from "@/server/reports/schemas";
import { getUnmappedItems } from "@/server/reports/unmapped";
import { defineExport } from "../define";

type UnmappedRow = UnmappedOutput["rows"][number];

// unmapped-items.csv (plan §3.1.2): the same query and service as GET /api/reports/unmapped-items.
export const unmappedExport = defineExport<UnmappedQuery, UnmappedOutput, UnmappedRow>({
  slug: "unmapped-items",
  schema: unmappedQuery,
  parse: (url) => parseQuery(unmappedQuery, url),
  load: (supabase, _session, query) => getUnmappedItems(supabase, query),
  rows: (output) => output.rows,
  columns: () => [
    { header: "menu_item_id", cell: (r) => cell.text(r.menuItemId) },
    { header: "piatto", cell: (r) => cell.text(r.name) },
    { header: "piatti", cell: (r) => cell.number(r.plates) },
    { header: "ricavi_lordi_eur", cell: (r) => cell.number(r.revenueGrossEur) },
    { header: "ultima_vendita", cell: (r) => cell.date(r.lastSoldOn) },
  ],
  range: (output) => `${output.weekFrom}_${output.weekTo}`,
});
