// Constants of the KPI reports (M22 plan §3.5). Each mirrors a rule of the SQL migrations 20261112100100, 20261112100200 and 20261112100400;
// tests/parity/reports-sql-parity.test.ts keeps them in step. The SQL stays the authority.

/** Mirrors app.kpi_period, in order. */
export const PERIODS = ["day", "week", "month", "custom"] as const;
export type Period = (typeof PERIODS)[number];

/** A custom range spans at most this many days (app.kpi_period; public.waste_costs has the same cap). */
export const MAX_RANGE_DAYS = 366;

/** A business date is final this many minutes after its cut-off (app.kpi_finalise_grace()). */
export const KPI_FINALISE_GRACE_MIN = 10;

/** The AVT count picker offers this many closed monthly counts (app.avt_available_counts()). */
export const AVT_AVAILABLE_COUNTS = 12;

/** One entry per figure compared with the previous period, in the order app.kpi_report_json computes them. */
export const DELTA_KEYS = [
  "covers",
  "tables",
  "revenueGrossEur",
  "revenueNetEur",
  "avgSpendPerCoverEur",
  "avgTicketEur",
  "plates",
  "foodCostEur",
  "foodCostPct",
  "purchasesEur",
  "wasteEur",
  "appTotalEur",
] as const;
export type DeltaKey = (typeof DELTA_KEYS)[number];
