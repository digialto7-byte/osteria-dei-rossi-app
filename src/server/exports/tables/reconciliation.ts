import { cell } from "@/lib/csv/write";
import { getReconciliation } from "@/server/counts/reconciliation";
import { parseReconciliationQuery } from "@/server/counts/schemas";
import type { Reconciliation, ReconciliationItem } from "@/server/counts/types";
import { defineExport } from "../define";

// reconciliation.csv (plan §3.1.2): the same parser and service as GET /api/reports/reconciliation. Quantities only.
export const reconciliationExport = defineExport<
  { from: string | null; to: string | null; location: string | null },
  Reconciliation,
  ReconciliationItem
>({
  slug: "reconciliation",
  parse: parseReconciliationQuery,
  load: (supabase, _session, query) => getReconciliation(supabase, query),
  rows: (output) => output.items,
  columns: () => [
    { header: "ingredient_id", cell: (r) => cell.text(r.ingredientId) },
    { header: "ingrediente", cell: (r) => cell.text(r.name) },
    { header: "unita", cell: (r) => cell.text(r.baseUnit) },
    { header: "iniziale", cell: (r) => cell.number(r.openingQty) },
    { header: "carichi", cell: (r) => cell.number(r.receiptsQty) },
    { header: "consumi", cell: (r) => cell.number(r.consumptionQty) },
    { header: "scarti", cell: (r) => cell.number(r.wasteQty) },
    { header: "trasferimenti_in", cell: (r) => cell.number(r.transfersInQty) },
    { header: "trasferimenti_out", cell: (r) => cell.number(r.transfersOutQty) },
    { header: "rettifiche_conteggio", cell: (r) => cell.number(r.countAdjustmentsQty) },
    { header: "altro", cell: (r) => cell.number(r.otherQty) },
    { header: "finale", cell: (r) => cell.number(r.closingQty) },
    { header: "quadra", cell: (r) => cell.bool(r.balanced) },
    { header: "contato", cell: (r) => cell.number(r.countedQty) },
    { header: "contato_il", cell: (r) => cell.instant(r.countedAt) },
    { header: "conteggio_id", cell: (r) => cell.text(r.countSessionId) },
    { header: "dopo_conteggio", cell: (r) => cell.number(r.afterCountQty) },
    { header: "coincide", cell: (r) => cell.bool(r.matchesCount) },
  ],
  range: (output) => `${output.from}_${output.to}`,
});
