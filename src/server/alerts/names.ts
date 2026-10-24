import type { SupabaseClient } from "@supabase/supabase-js";
import { reportError } from "@/lib/observability/report";
import { TEMPLATES, type NameTable } from "./templates";
import { isAlertKind } from "./kinds";

/** Names resolved when an alert is shown (M12 plan §3.1.9), never stored in a payload. */
export type AlertNames = Readonly<Partial<Record<NameTable, ReadonlyMap<string, string>>>>;
/** What loadNames returns: every table has a map. Templates accept the partial form so a test can pass a few. */
export type LoadedAlertNames = Readonly<Record<NameTable, ReadonlyMap<string, string>>>;
export type AlertNameRefs = Record<NameTable, string[]>;

export const NO_NAMES: AlertNames = {
  ingredient: new Map(),
  location: new Map(),
  recipe: new Map(),
  supplier: new Map(),
  raw_lot: new Map(),
  batch: new Map(),
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Where each name comes from, all read on the reader's session: the table or view, the column that holds the id the
 * payload carries, and the column that holds the text. A recipe is named by its stable key (the current version's name).
 */
const SOURCES: Readonly<
  Record<NameTable, { source: string; idColumn: string; labelColumn: string }>
> = {
  ingredient: { source: "ingredient", idColumn: "id", labelColumn: "name" },
  location: { source: "location", idColumn: "id", labelColumn: "name" },
  recipe: { source: "v_recipe_current", idColumn: "recipe_key", labelColumn: "name" },
  supplier: { source: "supplier", idColumn: "id", labelColumn: "name" },
  raw_lot: { source: "raw_lot", idColumn: "id", labelColumn: "lot_code" },
  batch: { source: "batch", idColumn: "id", labelColumn: "lot_code" },
};
const TABLES = Object.keys(SOURCES) as readonly NameTable[];

/** The name of a record, or undefined (the template then shows its neutral word). */
export function nameOf(names: AlertNames, table: NameTable, id: string | null): string | undefined {
  return id === null ? undefined : names[table]?.get(id);
}

/** The ids to look up: only from kinds whose template declares `nameRefs`, valid uuids only, no repeats. */
export function collectNameRefs(
  rows: ReadonlyArray<{ kind: string; payload: unknown }>,
): AlertNameRefs {
  const found = Object.fromEntries(TABLES.map((table) => [table, new Set<string>()])) as Record<
    NameTable,
    Set<string>
  >;
  for (const row of rows) {
    if (!isAlertKind(row.kind)) continue;
    const refs = TEMPLATES[row.kind].nameRefs;
    const payload = row.payload;
    if (!refs || payload === null || typeof payload !== "object" || Array.isArray(payload))
      continue;
    for (const [key, table] of Object.entries(refs)) {
      const value = (payload as Record<string, unknown>)[key];
      if (typeof value === "string" && UUID.test(value)) found[table].add(value);
    }
  }
  return Object.fromEntries(TABLES.map((table) => [table, [...found[table]]])) as Record<
    NameTable,
    string[]
  >;
}

/**
 * One `select id, name ... in (ids)` per table, on the READER's session: RLS applies, so a name the
 * reader may not see is simply missing (the alert then shows a neutral word). A failed read is
 * reported by SQLSTATE only and never fails the alert list.
 */
export async function loadNames(
  supabase: SupabaseClient,
  refs: AlertNameRefs,
): Promise<LoadedAlertNames> {
  const names = Object.fromEntries(
    TABLES.map((table) => [table, new Map<string, string>()]),
  ) as Record<NameTable, Map<string, string>>;
  for (const table of TABLES) {
    const ids = refs[table];
    if (ids.length === 0) continue;
    const { source, idColumn, labelColumn } = SOURCES[table];
    const { data, error } = await supabase
      .from(source)
      .select(`${idColumn}, ${labelColumn}`)
      .in(idColumn, ids);
    if (error) {
      reportError(new Error(`Alert names: ${table} read failed ${error.code ?? "unknown"}`));
      continue;
    }
    for (const entry of (data ?? []) as unknown as Array<Record<string, string>>) {
      const id = entry[idColumn];
      const label = entry[labelColumn];
      if (id !== undefined && label !== undefined) names[table].set(id, label);
    }
  }
  return names;
}
