import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";
import type { TenantSession } from "@/lib/api/with-api";
import type { Cell } from "@/lib/csv/write";

/** The 11 report tables of M24 (plan §3.1.2, Q169). The slug is the file name: `/api/exports/<slug>.csv`. */
export const EXPORT_SLUGS = [
  "kpis",
  "items",
  "avt",
  "unmapped-items",
  "discards-vs-push",
  "push-list",
  "forecast",
  "forecast-plates",
  "waste-costs",
  "count-variance",
  "reconciliation",
] as const;
export type ExportSlug = (typeof EXPORT_SLUGS)[number];

/** Exports are owner and admin only (plan §3.1.6, AT4). */
export type ExportRole = "owner" | "admin";

// Method syntax on purpose: it makes the members bivariant, so a table over a concrete query and output type is assignable to AnyExportTable.
export interface Column<R> {
  header: string;
  cell(row: R): Cell;
}

export interface ExportTable<Q, O, R> {
  slug: ExportSlug;
  /** The JSON route's own query schema when it has one (identity-tested against the route's import); absent when the route has its own parse function. */
  schema?: z.ZodType;
  /** The JSON route's own parser: the same strict parse of the same query string. */
  parse(url: URL): Q;
  /** The JSON route's own service call (the services make the RPC; nothing here does). */
  load(supabase: SupabaseClient, session: TenantSession, query: Q): Promise<O>;
  rows(output: O): readonly R[];
  columns(role: ExportRole): readonly Column<R>[];
  /** The part of the file name after the slug: "2026-10-01_2026-10-31" or "2026-11-04". */
  range(output: O): string;
}

export type AnyExportTable = ExportTable<unknown, unknown, unknown>;
