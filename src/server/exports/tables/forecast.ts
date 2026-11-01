import { cell } from "@/lib/csv/write";
import { parseQuery } from "@/server/counts/schemas";
import { getForecast } from "@/server/push/forecast";
import type { ForecastOutput } from "@/server/push/output";
import { forecastQuery, type ForecastQuery } from "@/server/push/schemas";
import { defineExport } from "../define";

type BatchRow = ForecastOutput["batches"][number] & { date: string };
type PlateRow = ForecastOutput["plates"][number] & { date: string };

// forecast.csv and forecast-plates.csv (plan §3.1.2): the same query and service as GET /api/reports/forecast, one file per table. `data` is the
// reply's date on every row. The expected covers (a KPI) are not exported.
export const forecastExport = defineExport<ForecastQuery, ForecastOutput, BatchRow>({
  slug: "forecast",
  schema: forecastQuery,
  parse: (url) => parseQuery(forecastQuery, url),
  load: (supabase, session, query) => getForecast(supabase, session.role, query),
  rows: (output) => output.batches.map((b) => ({ ...b, date: output.date })),
  columns: () => [
    { header: "recipe_key", cell: (r) => cell.text(r.recipeKey) },
    { header: "preparazione", cell: (r) => cell.text(r.name) },
    { header: "data", cell: (r) => cell.date(r.date) },
    { header: "porzioni_attese", cell: (r) => cell.number(r.expectedPortions) },
    { header: "porzioni_disponibili", cell: (r) => cell.number(r.onHandPortions) },
    { header: "mancanti", cell: (r) => cell.number(r.gap) },
  ],
  range: (output) => output.date,
});

export const forecastPlatesExport = defineExport<ForecastQuery, ForecastOutput, PlateRow>({
  slug: "forecast-plates",
  schema: forecastQuery,
  parse: (url) => parseQuery(forecastQuery, url),
  load: (supabase, session, query) => getForecast(supabase, session.role, query),
  rows: (output) => output.plates.map((p) => ({ ...p, date: output.date })),
  columns: () => [
    { header: "menu_item_id", cell: (r) => cell.text(r.menuItemId) },
    { header: "piatto", cell: (r) => cell.text(r.name) },
    { header: "data", cell: (r) => cell.date(r.date) },
    { header: "piatti_attesi", cell: (r) => cell.number(r.expectedPlates) },
  ],
  range: (output) => output.date,
});
