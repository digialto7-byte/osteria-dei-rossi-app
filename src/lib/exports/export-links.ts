import type { ExportSlug } from "@/server/exports/types";

// Pure string work (M24 plan §3.1.10): a CSV link carries the same query as the JSON request the screen makes, so the file is the table on screen.
// Nothing here computes a date or a number.

type QueryValue = string | null | undefined;

function queryString(query: string | Record<string, QueryValue>): string {
  if (typeof query === "string") return query;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== null && value !== undefined && value !== "") params.set(key, value);
  }
  return params.toString();
}

/** `/api/exports/<slug>.csv` with the screen's query (a string as the screen's JSON request has it, or a record of values). */
export function csvHref(slug: ExportSlug, query: string | Record<string, QueryValue> = ""): string {
  const text = queryString(query);
  return `/api/exports/${slug}.csv${text === "" ? "" : `?${text}`}`;
}

// The JSON endpoints that have exactly one CSV. The forecast has two (preparations and plates), so its screen names them itself.
const SLUG_OF_ENDPOINT: Record<string, ExportSlug> = {
  "/api/reports/kpis": "kpis",
  "/api/reports/items": "items",
  "/api/reports/avt": "avt",
  "/api/reports/unmapped-items": "unmapped-items",
  "/api/reports/discards-vs-push": "discards-vs-push",
  "/api/reports/push-list": "push-list",
  "/api/stock/waste-costs": "waste-costs",
  "/api/reports/reconciliation": "reconciliation",
};

/** The CSV link of the JSON request a screen makes (`/api/reports/kpis?period=day` -> `/api/exports/kpis.csv?period=day`); null when it has none. */
export function csvHrefForEndpoint(endpoint: string): string | null {
  const [path = "", ...rest] = endpoint.split("?");
  const slug = Object.hasOwn(SLUG_OF_ENDPOINT, path) ? SLUG_OF_ENDPOINT[path] : undefined;
  return slug ? csvHref(slug, rest.join("?")) : null;
}
