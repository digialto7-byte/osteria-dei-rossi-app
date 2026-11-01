import { cell } from "@/lib/csv/write";
import { parseQuery } from "@/server/counts/schemas";
import { getPushList } from "@/server/push/list";
import type { ManagerPushList, PushListOutput } from "@/server/push/output";
import { pushListQuery } from "@/server/push/schemas";
import { defineExport } from "../define";

type PushRow = ManagerPushList["rows"][number];

/** Names joined with " | " in API order. */
const names = (list: readonly { name: string }[]) => list.map((x) => x.name).join(" | ");

// push-list.csv (plan §3.1.2): the same service as GET /api/reports/push-list. Exports are owner and admin, so the reply is the manager shape (with
// the cost at risk); the chef's shape here would be a programming error. `tipo` is the reply's raw "batch" / "lot".
export const pushListExport = defineExport<Record<string, never>, PushListOutput, PushRow>({
  slug: "push-list",
  schema: pushListQuery,
  parse: (url) => parseQuery(pushListQuery, url),
  load: (supabase, session) => getPushList(supabase, session.role),
  rows: (output) => {
    if (output.role === "chef") throw new Error("push-list export got the chef's reply");
    return output.rows;
  },
  columns: () => [
    { header: "tipo", cell: (r) => cell.text(r.kind) },
    { header: "id", cell: (r) => cell.text(r.id) },
    { header: "nome", cell: (r) => cell.text(r.name) },
    { header: "lotto", cell: (r) => cell.text(r.lotCode) },
    { header: "prodotto_il", cell: (r) => cell.date(r.madeOn) },
    { header: "consumare_entro", cell: (r) => cell.instant(r.useByAt) },
    { header: "scadenza", cell: (r) => cell.date(r.expiryDate) },
    { header: "ore_rimaste", cell: (r) => cell.number(r.hoursToUseBy) },
    { header: "quantita", cell: (r) => cell.number(r.quantity) },
    { header: "unita", cell: (r) => cell.text(r.unit) },
    { header: "costo_a_rischio_eur", cell: (r) => cell.number(r.costAtRiskEur) },
    { header: "piatti", cell: (r) => cell.text(names(r.plates)) },
    {
      header: "piatti_in_evidenza",
      cell: (r) => cell.text(names(r.plates.filter((p) => p.pushed))),
    },
    { header: "preparazioni", cell: (r) => cell.text(names(r.batchRecipes)) },
  ],
  range: (output) => output.businessDate,
});
