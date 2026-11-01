import { cell } from "@/lib/csv/write";
import { parseWasteCostsQuery } from "@/server/stock/schemas";
import type { WasteCosts } from "@/server/stock/types";
import { getWasteCosts } from "@/server/stock/waste-costs";
import { defineExport } from "../define";

// waste-costs.csv (plan §3.1.2): the same parser and service as GET /api/stock/waste-costs. Per reason, in API order: its raw-ingredient lines, then
// its batch lines. `senza_costo` counts the operations without a cost: a batch line's unvaluedCount, and 1 for a raw line whose value is null.
export interface WasteCsvRow {
  reason: string;
  kind: "ingrediente" | "preparazione";
  id: string;
  name: string;
  unit: string;
  qty: number;
  valueEur: number | null;
  unvalued: number;
}

export const wasteCostsExport = defineExport<
  { from: string | null; to: string | null },
  WasteCosts,
  WasteCsvRow
>({
  slug: "waste-costs",
  parse: parseWasteCostsQuery,
  load: (supabase, _session, query) => getWasteCosts(supabase, query),
  rows: (output) =>
    output.reasons.flatMap((reason) => [
      ...reason.lines.map((line): WasteCsvRow => ({
        reason: reason.reasonCode,
        kind: "ingrediente",
        id: line.ingredientId,
        name: line.ingredientName,
        unit: line.baseUnit,
        qty: line.qty,
        valueEur: line.valueEur,
        unvalued: line.valueEur === null ? 1 : 0,
      })),
      ...reason.batchLines.map((line): WasteCsvRow => ({
        reason: reason.reasonCode,
        kind: "preparazione",
        id: line.recipeKey,
        name: line.recipeName,
        unit: "porz",
        qty: line.portions,
        valueEur: line.valueEur,
        unvalued: line.unvaluedCount,
      })),
    ]),
  columns: () => [
    { header: "motivo", cell: (r) => cell.text(r.reason) },
    { header: "tipo", cell: (r) => cell.text(r.kind) },
    { header: "id", cell: (r) => cell.text(r.id) },
    { header: "nome", cell: (r) => cell.text(r.name) },
    { header: "unita", cell: (r) => cell.text(r.unit) },
    { header: "quantita", cell: (r) => cell.number(r.qty) },
    { header: "valore_eur", cell: (r) => cell.number(r.valueEur) },
    { header: "senza_costo", cell: (r) => cell.number(r.unvalued) },
  ],
  range: (output) => `${output.from}_${output.to}`,
});
