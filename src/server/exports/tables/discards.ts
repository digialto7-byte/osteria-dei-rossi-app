import { cell } from "@/lib/csv/write";
import { parseQuery } from "@/server/counts/schemas";
import { getDiscardsVsPush } from "@/server/push/discards";
import type { DiscardsOutput } from "@/server/push/output";
import { discardsQuery, type DiscardsQuery } from "@/server/push/schemas";
import { defineExport } from "../define";

type DiscardRow = DiscardsOutput["rows"][number];

// discards-vs-push.csv (plan §3.1.2): the same query and service as GET /api/reports/discards-vs-push. The totals are not a row.
export const discardsExport = defineExport<DiscardsQuery, DiscardsOutput, DiscardRow>({
  slug: "discards-vs-push",
  schema: discardsQuery,
  parse: (url) => parseQuery(discardsQuery, url),
  load: (supabase, _session, query) => getDiscardsVsPush(supabase, query),
  rows: (output) => output.rows,
  columns: () => [
    { header: "recipe_key", cell: (r) => cell.text(r.recipeKey) },
    { header: "preparazione", cell: (r) => cell.text(r.name) },
    { header: "durata_ore", cell: (r) => cell.number(r.shelfLifeHours) },
    { header: "lotti_scartati", cell: (r) => cell.number(r.batchesDiscarded) },
    { header: "lotti_in_evidenza", cell: (r) => cell.number(r.batchesPushed) },
    { header: "porzioni_scartate", cell: (r) => cell.number(r.portionsDiscarded) },
    { header: "porzioni_in_evidenza", cell: (r) => cell.number(r.portionsPushed) },
    { header: "valore_eur", cell: (r) => cell.number(r.valueEur) },
    { header: "senza_costo", cell: (r) => cell.number(r.unvaluedCount) },
  ],
  range: (output) => `${output.weekFrom}_${output.weekTo}`,
});
