import type { SupabaseClient } from "@supabase/supabase-js";
import { unwrapCost } from "./errors";
import type { MissingIngredient } from "./types";

/** The ingredients named by id, in the order given; an id the caller cannot read keeps its id as name. */
export async function namedIngredients(
  supabase: SupabaseClient,
  ids: readonly string[] | null | undefined,
): Promise<MissingIngredient[]> {
  const unique = [...new Set(ids ?? [])];
  if (unique.length === 0) return [];
  const rows =
    unwrapCost<{ id: string; name: string }[] | null>(
      await supabase.from("ingredient").select("id, name").in("id", unique),
    ) ?? [];
  const names = new Map(rows.map((row) => [row.id, row.name]));
  return unique.map((id) => ({ id, name: names.get(id) ?? id }));
}

/** Every missing ingredient id of several rows, looked up once. */
export async function nameLookup(
  supabase: SupabaseClient,
  idLists: readonly (readonly string[] | null | undefined)[],
): Promise<(ids: readonly string[] | null | undefined) => MissingIngredient[]> {
  const all = await namedIngredients(
    supabase,
    idLists.flatMap((ids) => ids ?? []),
  );
  const names = new Map(all.map((item) => [item.id, item.name]));
  return (ids) => [...new Set(ids ?? [])].map((id) => ({ id, name: names.get(id) ?? id }));
}
