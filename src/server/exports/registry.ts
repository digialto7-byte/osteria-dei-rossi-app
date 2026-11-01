import { avtExport } from "./tables/avt";
import { countVarianceExport } from "./tables/count-variance";
import { discardsExport } from "./tables/discards";
import { forecastExport, forecastPlatesExport } from "./tables/forecast";
import { itemsExport } from "./tables/items";
import { kpisExport } from "./tables/kpis";
import { pushListExport } from "./tables/push-list";
import { reconciliationExport } from "./tables/reconciliation";
import { unmappedExport } from "./tables/unmapped";
import { wasteCostsExport } from "./tables/waste-costs";
import { EXPORT_SLUGS, type AnyExportTable, type ExportSlug } from "./types";

// The export registry (ADR-027): each slug is bound to the SAME query schema (or parse function) and the SAME service call as its JSON route. No SQL here.
export const registry = {
  kpis: kpisExport,
  items: itemsExport,
  avt: avtExport,
  "unmapped-items": unmappedExport,
  "discards-vs-push": discardsExport,
  "push-list": pushListExport,
  forecast: forecastExport,
  "forecast-plates": forecastPlatesExport,
  "waste-costs": wasteCostsExport,
  "count-variance": countVarianceExport,
  reconciliation: reconciliationExport,
} satisfies Record<ExportSlug, AnyExportTable>;

/** The table of a slug, or undefined for a name that is not an export. */
export function findExport(slug: string): AnyExportTable | undefined {
  return (EXPORT_SLUGS as readonly string[]).includes(slug)
    ? (registry as Record<string, AnyExportTable>)[slug]
    : undefined;
}
