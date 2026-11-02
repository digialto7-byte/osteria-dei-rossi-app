import { cell } from "@/lib/csv/write";
import { parseQuery } from "@/server/counts/schemas";
import { periodQuery, type PeriodQuery } from "@/server/reports/schemas";
import { getServicesReport } from "@/server/services/report";
import type { ServicesReport } from "@/server/services/output";
import { defineExport } from "../define";
import type { Column } from "../types";

// services.csv (M25c plan §3.4): the same query and service as GET /api/reports/services. One row per service in the reply's order, then a total row
// with an empty key and the name "Totale". The columns are the same for the owner and the admin; no staff name, no fixed cost.

type Block = ServicesReport["total"];
interface ServiceCsvRow extends Block {
  key: string | null;
  name: string;
}

const COLUMNS: readonly Column<ServiceCsvRow>[] = [
  { header: "chiave", cell: (r) => cell.text(r.key) },
  { header: "servizio", cell: (r) => cell.text(r.name) },
  { header: "coperti", cell: (r) => cell.number(r.covers) },
  { header: "tavoli", cell: (r) => cell.number(r.tables) },
  { header: "incasso_lordo_eur", cell: (r) => cell.number(r.revenueGrossEur) },
  { header: "incasso_netto_eur", cell: (r) => cell.number(r.revenueNetEur) },
  { header: "spesa_media_coperto_eur", cell: (r) => cell.number(r.avgSpendPerCoverEur) },
  { header: "scontrino_medio_eur", cell: (r) => cell.number(r.avgTicketEur) },
  { header: "piatti", cell: (r) => cell.number(r.plates) },
  { header: "food_cost_eur", cell: (r) => cell.number(r.foodCostEur) },
  { header: "food_cost_pct", cell: (r) => cell.number(r.foodCostPct) },
  { header: "quota_incasso_pct", cell: (r) => cell.number(r.revenueSharePct) },
];

export const servicesExport = defineExport<PeriodQuery, ServicesReport, ServiceCsvRow>({
  slug: "services",
  schema: periodQuery,
  parse: (url) => parseQuery(periodQuery, url),
  load: (supabase, _session, query) => getServicesReport(supabase, query),
  rows: (output) => [
    ...output.services.map((service) => ({ ...service, key: service.key as string | null })),
    { ...output.total, key: null, name: "Totale" },
  ],
  columns: () => COLUMNS,
  range: (output) => (output.from === output.to ? output.from : `${output.from}_${output.to}`),
});
