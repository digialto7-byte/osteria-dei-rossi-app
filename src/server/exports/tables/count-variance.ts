import { cell } from "@/lib/csv/write";
import { venueDate } from "@/lib/time/venue-date";
import { parseVarianceQuery } from "@/server/counts/schemas";
import type { Variance, VarianceCosts, VarianceLine } from "@/server/counts/types";
import { getVariance } from "@/server/counts/variance";
import { getVarianceCosts } from "@/server/counts/variance-costs";
import { defineExport } from "../define";

// count-variance.csv (plan §3.1.2): the two services behind the screen /magazzino/conteggi/[id]/scostamenti, GET /api/reports/variance (quantities)
// and GET /api/reports/variance-costs (EUR), one call each, joined by ingredient. The session's staff names are not exported.
export interface CountVarianceOutput {
  variance: Variance;
  costs: VarianceCosts;
}

export interface CountVarianceRow extends VarianceLine {
  valueEur: number | null;
}

export const countVarianceExport = defineExport<
  { session: string },
  CountVarianceOutput,
  CountVarianceRow
>({
  slug: "count-variance",
  parse: parseVarianceQuery,
  load: async (supabase, _session, query) => {
    const [variance, costs] = await Promise.all([
      getVariance(supabase, query.session),
      getVarianceCosts(supabase, query.session),
    ]);
    return { variance, costs };
  },
  rows: ({ variance, costs }) => {
    const known = new Set(variance.lines.map((l) => l.ingredientId));
    const costOf = new Map<string, number | null>();
    for (const line of costs.lines) {
      // A cost for an ingredient the variance does not list means the two replies disagree: a 500, never a silent row.
      if (!known.has(line.ingredientId)) {
        throw new Error("count-variance export: a cost line has no variance line");
      }
      costOf.set(line.ingredientId, line.valueEur);
    }
    return variance.lines.map((line) => ({
      ...line,
      valueEur: costOf.get(line.ingredientId) ?? null,
    }));
  },
  columns: () => [
    { header: "ingredient_id", cell: (r) => cell.text(r.ingredientId) },
    { header: "ingrediente", cell: (r) => cell.text(r.name) },
    { header: "unita", cell: (r) => cell.text(r.baseUnit) },
    { header: "atteso", cell: (r) => cell.number(r.expectedQty) },
    { header: "contato", cell: (r) => cell.number(r.countedQty) },
    { header: "differenza", cell: (r) => cell.number(r.differenceQty) },
    { header: "registrato", cell: (r) => cell.number(r.postedQty) },
    { header: "valore_eur", cell: (r) => cell.number(r.valueEur) },
  ],
  range: ({ variance }) =>
    venueDate(new Date(variance.session.closedAt ?? variance.session.startedAt)),
});
