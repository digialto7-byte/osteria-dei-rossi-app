import { cell } from "@/lib/csv/write";
import { parseQuery } from "@/server/counts/schemas";
import { getKpiItems } from "@/server/reports/items";
import type { ItemsOutput, OwnerItemsOutput } from "@/server/reports/output";
import { periodQuery, type PeriodQuery } from "@/server/reports/schemas";
import { defineExport } from "../define";
import type { Column } from "../types";

// items.csv (plan §3.1.2): the same query and service as GET /api/reports/items. The columns follow the caller's role: the owner's rows add the four
// fixed-cost columns, the admin's cannot (Q107). `portata`, `stato` and `motivo_costo_fisso` are the raw values of the reply.

type ItemRow = ItemsOutput["rows"][number];
type OwnerRow = OwnerItemsOutput["rows"][number];

/** An owner column asked of a row that is not an owner row is a programming error: it must never become a blank cell. */
function owner(row: ItemRow): OwnerRow {
  if (!("fixedCostPerPlateEur" in row)) throw new Error("owner column on an admin item row");
  return row;
}

const BASE: readonly Column<ItemRow>[] = [
  { header: "menu_item_id", cell: (r) => cell.text(r.menuItemId) },
  { header: "piatto", cell: (r) => cell.text(r.name) },
  { header: "portata", cell: (r) => cell.text(r.course) },
  { header: "piatti", cell: (r) => cell.number(r.plates) },
  { header: "mix_pct", cell: (r) => cell.number(r.mixPct) },
  { header: "ricavi_netti_eur", cell: (r) => cell.number(r.revenueNetEur) },
  { header: "piatti_con_costo", cell: (r) => cell.number(r.costedPlates) },
  { header: "ricavi_netti_con_costo_eur", cell: (r) => cell.number(r.costedRevenueNetEur) },
  { header: "food_cost_eur", cell: (r) => cell.number(r.foodCostEur) },
  { header: "food_cost_pct", cell: (r) => cell.number(r.foodCostPct) },
  { header: "margine_cibo_per_piatto_eur", cell: (r) => cell.number(r.foodMarginPerPlateEur) },
  { header: "stato", cell: (r) => cell.text(r.status) },
  // A dish sold by weight (P2-0b): the grams sold and the average grams per plate; empty for the others.
  { header: "peso_venduto_g", cell: (r) => cell.number(r.weightG) },
  { header: "peso_medio_g", cell: (r) => cell.number(r.avgWeightG) },
];

const OWNER_ONLY: readonly Column<ItemRow>[] = [
  { header: "costo_fisso_per_piatto_eur", cell: (r) => cell.number(owner(r).fixedCostPerPlateEur) },
  {
    header: "margine_lordo_per_piatto_eur",
    cell: (r) => cell.number(owner(r).grossMarginPerPlateEur),
  },
  { header: "contributo_eur", cell: (r) => cell.number(owner(r).contributionEur) },
  { header: "motivo_costo_fisso", cell: (r) => cell.text(owner(r).fixedCostReason) },
];

export const itemsExport = defineExport<PeriodQuery, ItemsOutput, ItemRow>({
  slug: "items",
  schema: periodQuery,
  parse: (url) => parseQuery(periodQuery, url),
  load: (supabase, session, query) => getKpiItems(supabase, session.role, query),
  rows: (output) => output.rows,
  columns: (role) => (role === "owner" ? [...BASE, ...OWNER_ONLY] : BASE),
  range: (output) => `${output.from}_${output.to}`,
});
