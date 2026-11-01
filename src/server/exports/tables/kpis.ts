import { parseQuery } from "@/server/counts/schemas";
import { cell } from "@/lib/csv/write";
import type { DeltaKey } from "@/server/reports/constants";
import { getKpiReport } from "@/server/reports/kpis";
import type { KpiBlock, KpiReport } from "@/server/reports/output";
import { periodQuery, type PeriodQuery } from "@/server/reports/schemas";
import { defineExport } from "../define";
import type { Column } from "../types";

// kpis.csv (plan §3.1.2): the same query and service as GET /api/reports/kpis, rendered as 54 fixed rows. The first 23 are the figures of the KPI
// block, then the covers by hour (00-23) and by weekday (1 = Monday). Labels are Italian, keys are the JSON property names (machine keys, A3).

interface KpiCsvDef {
  key: string;
  label: string;
  pick(block: KpiBlock): number | null;
  /** The delta entry of the reply this row is compared with; only the 12 DELTA_KEYS have one. */
  delta: DeltaKey | null;
}

const FIGURES: KpiCsvDef[] = [
  { key: "daysFinal", label: "Giorni definitivi", pick: (b) => b.daysFinal, delta: null },
  { key: "days", label: "Giorni nel periodo", pick: (b) => b.days, delta: null },
  { key: "covers", label: "Coperti", pick: (b) => b.covers, delta: "covers" },
  { key: "tables", label: "Tavoli", pick: (b) => b.tables, delta: "tables" },
  {
    key: "revenueGrossEur",
    label: "Ricavi lordi (€)",
    pick: (b) => b.revenueGrossEur,
    delta: "revenueGrossEur",
  },
  {
    key: "revenueNetEur",
    label: "Ricavi netti (€)",
    pick: (b) => b.revenueNetEur,
    delta: "revenueNetEur",
  },
  { key: "copertoNetEur", label: "Coperto netto (€)", pick: (b) => b.copertoNetEur, delta: null },
  {
    key: "avgSpendPerCoverEur",
    label: "Spesa media per coperto (€)",
    pick: (b) => b.avgSpendPerCoverEur,
    delta: "avgSpendPerCoverEur",
  },
  {
    key: "avgTicketEur",
    label: "Scontrino medio (€)",
    pick: (b) => b.avgTicketEur,
    delta: "avgTicketEur",
  },
  { key: "plates", label: "Piatti", pick: (b) => b.plates, delta: "plates" },
  { key: "foodCostEur", label: "Food cost (€)", pick: (b) => b.foodCostEur, delta: "foodCostEur" },
  { key: "foodCostPct", label: "Food cost (%)", pick: (b) => b.foodCostPct, delta: "foodCostPct" },
  {
    key: "costedRevenueNetEur",
    label: "Ricavi netti con costo (€)",
    pick: (b) => b.costedRevenueNetEur,
    delta: null,
  },
  {
    key: "uncostedRevenueNetEur",
    label: "Ricavi netti senza costo (€)",
    pick: (b) => b.uncostedRevenueNetEur,
    delta: null,
  },
  {
    key: "costedSharePct",
    label: "Quota ricavi con costo (%)",
    pick: (b) => b.costedSharePct,
    delta: null,
  },
  {
    key: "purchasesEur",
    label: "Acquisti (€)",
    pick: (b) => b.purchasesEur,
    delta: "purchasesEur",
  },
  {
    key: "purchasesUnvaluedCount",
    label: "Righe di acquisto senza costo",
    pick: (b) => b.purchasesUnvaluedCount,
    delta: null,
  },
  { key: "wasteEur", label: "Sprechi (€)", pick: (b) => b.waste.valueEur, delta: "wasteEur" },
  {
    key: "wasteUnvaluedCount",
    label: "Righe di spreco senza costo",
    pick: (b) => b.waste.unvaluedCount,
    delta: null,
  },
  {
    key: "appTotalEur",
    label: "Totale app (€)",
    pick: (b) => b.appVsRegister.appTotalEur,
    delta: "appTotalEur",
  },
  {
    key: "registerTotalEur",
    label: "Totale registratore (€)",
    pick: (b) => b.appVsRegister.registerTotalEur,
    delta: null,
  },
  {
    key: "appVsRegisterDiffEur",
    label: "Differenza app-registratore (€)",
    pick: (b) => b.appVsRegister.difference?.amount ?? null,
    delta: null,
  },
  {
    key: "appVsRegisterDiffPct",
    label: "Differenza app-registratore (%)",
    pick: (b) => b.appVsRegister.difference?.pct ?? null,
    delta: null,
  },
];

const WEEKDAYS = ["lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato", "domenica"];

const HOURS: KpiCsvDef[] = Array.from({ length: 24 }, (_, hour) => ({
  key: `coversByHour.${String(hour).padStart(2, "0")}`,
  label: `Coperti ore ${String(hour).padStart(2, "0")}`,
  pick: (b: KpiBlock) => b.coversByHour[hour] ?? null,
  delta: null,
}));

const DAYS: KpiCsvDef[] = WEEKDAYS.map((name, index) => ({
  key: `coversByWeekday.${index + 1}`,
  label: `Coperti ${name}`,
  pick: (b: KpiBlock) => b.coversByWeekday[index] ?? null,
  delta: null,
}));

/** The 54 rows, in file order. */
export const KPI_CSV_ROWS: readonly KpiCsvDef[] = [...FIGURES, ...HOURS, ...DAYS];

export interface KpiCsvRow {
  key: string;
  label: string;
  current: number | null;
  previous: number | null;
  delta: { abs: number; pct: number | null } | null;
}

const COLUMNS: readonly Column<KpiCsvRow>[] = [
  { header: "chiave", cell: (r) => cell.text(r.key) },
  { header: "voce", cell: (r) => cell.text(r.label) },
  { header: "valore", cell: (r) => cell.number(r.current) },
  { header: "valore_precedente", cell: (r) => cell.number(r.previous) },
  { header: "differenza", cell: (r) => cell.number(r.delta?.abs ?? null) },
  { header: "differenza_pct", cell: (r) => cell.number(r.delta?.pct ?? null) },
];

export const kpisExport = defineExport<PeriodQuery, KpiReport, KpiCsvRow>({
  slug: "kpis",
  schema: periodQuery,
  parse: (url) => parseQuery(periodQuery, url),
  load: (supabase, _session, query) => getKpiReport(supabase, query),
  rows: (output) =>
    KPI_CSV_ROWS.map((def) => ({
      key: def.key,
      label: def.label,
      current: def.pick(output.current),
      previous: def.pick(output.previous),
      delta: def.delta === null ? null : output.delta[def.delta],
    })),
  columns: () => COLUMNS,
  range: (output) => `${output.current.from}_${output.current.to}`,
});
