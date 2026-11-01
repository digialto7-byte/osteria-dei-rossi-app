import { cell } from "@/lib/csv/write";
import { venueDate } from "@/lib/time/venue-date";
import { parseQuery } from "@/server/counts/schemas";
import { getAvtReport } from "@/server/reports/avt";
import type { AvtOutput } from "@/server/reports/output";
import { avtQuery, type AvtQuery } from "@/server/reports/schemas";
import { defineExport } from "../define";

type AvtRow = AvtOutput["rows"][number];

// avt.csv (plan §3.1.2): the same query and service as GET /api/reports/avt. The file name carries the Rome date the closing count was closed.
export const avtExport = defineExport<AvtQuery, AvtOutput, AvtRow>({
  slug: "avt",
  schema: avtQuery,
  parse: (url) => parseQuery(avtQuery, url),
  load: (supabase, _session, query) => getAvtReport(supabase, query),
  rows: (output) => output.rows,
  columns: () => [
    { header: "ingredient_id", cell: (r) => cell.text(r.ingredientId) },
    { header: "ingrediente", cell: (r) => cell.text(r.name) },
    { header: "unita", cell: (r) => cell.text(r.baseUnit) },
    { header: "consumo_reale", cell: (r) => cell.number(r.actualQty) },
    { header: "consumo_teorico", cell: (r) => cell.number(r.theoreticalQty) },
    { header: "scarti", cell: (r) => cell.number(r.wasteQty) },
    { header: "scostamento", cell: (r) => cell.number(r.varianceQty) },
    { header: "costo_unitario_eur", cell: (r) => cell.number(r.unitCostEur) },
    { header: "scostamento_eur", cell: (r) => cell.number(r.varianceEur) },
  ],
  range: (output) => venueDate(new Date(output.count.closedAt)),
});
