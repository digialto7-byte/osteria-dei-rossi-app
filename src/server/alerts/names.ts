import type { SupabaseClient } from "@supabase/supabase-js";
import { reportError } from "@/lib/observability/report";
import { TEMPLATES, type NameTable } from "./templates";
import { isAlertKind } from "./kinds";

/** Names resolved when an alert is shown (M12 plan §3.1.9), never stored in a payload. */
export type AlertNames = Readonly<Record<NameTable, ReadonlyMap<string, string>>>;
export type AlertNameRefs = Record<NameTable, string[]>;

export const NO_NAMES: AlertNames = { ingredient: new Map(), location: new Map() };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TABLES: readonly NameTable[] = ["ingredient", "location"];

/** The ids to look up: only from kinds whose template declares `nameRefs`, valid uuids only, no repeats. */
export function collectNameRefs(
  rows: ReadonlyArray<{ kind: string; payload: unknown }>,
): AlertNameRefs {
  const found: Record<NameTable, Set<string>> = { ingredient: new Set(), location: new Set() };
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
  return { ingredient: [...found.ingredient], location: [...found.location] };
}

/**
 * One `select id, name ... in (ids)` per table, on the READER's session: RLS applies, so a name the
 * reader may not see is simply missing (the alert then shows a neutral word). A failed read is
 * reported by SQLSTATE only and never fails the alert list.
 */
export async function loadNames(
  supabase: SupabaseClient,
  refs: AlertNameRefs,
): Promise<AlertNames> {
  const names: Record<NameTable, Map<string, string>> = {
    ingredient: new Map(),
    location: new Map(),
  };
  for (const table of TABLES) {
    const ids = refs[table];
    if (ids.length === 0) continue;
    const { data, error } = await supabase.from(table).select("id, name").in("id", ids);
    if (error) {
      reportError(new Error(`Alert names: ${table} read failed ${error.code ?? "unknown"}`));
      continue;
    }
    for (const entry of (data ?? []) as Array<{ id: string; name: string }>) {
      names[table].set(entry.id, entry.name);
    }
  }
  return names;
}
