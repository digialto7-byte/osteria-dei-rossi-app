import type { SupabaseClient } from "@supabase/supabase-js";
import { mapCountDbError } from "./errors";
import { criticalChangeResponse, criticalListResponse } from "./output";
import type { CriticalBody } from "./schemas";
import type { CriticalChange } from "./types";
import type { BaseUnit } from "@/server/stock/types";

interface IngredientRow {
  id: string;
  name: string;
  base_unit: BaseUnit;
  is_critical: boolean;
}

/** GET /api/counts/critical: the active stock ingredients with their flag, read through RLS. */
export async function listCritical(supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from("ingredient")
    .select("id, name, base_unit, is_critical")
    .eq("is_active", true)
    .eq("is_stock", true)
    .order("name");
  if (error) throw mapCountDbError(error);
  const rows = (data ?? []) as IngredientRow[];
  return criticalListResponse.parse({
    items: rows.map((r) => ({
      ingredientId: r.id,
      name: r.name,
      baseUnit: r.base_unit,
      isCritical: r.is_critical,
    })),
    criticalCount: rows.filter((r) => r.is_critical).length,
  });
}

/** PATCH /api/counts/critical: flags or unflags an ingredient for the daily count (audited when it changes). */
export async function setCritical(
  supabase: SupabaseClient,
  body: CriticalBody,
): Promise<CriticalChange> {
  const { data, error } = await supabase.rpc("set_ingredient_critical", {
    p_ingredient: body.ingredientId,
    p_critical: body.critical,
  });
  if (error) throw mapCountDbError(error);
  const r = data as CriticalChange;
  return criticalChangeResponse.parse({
    ingredientId: r.ingredientId,
    isCritical: r.isCritical,
    changed: r.changed,
  });
}
