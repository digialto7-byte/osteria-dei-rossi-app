import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "@/lib/api/errors";
import type { AppRole } from "@/lib/api/with-api";
import type { Allergen } from "@/server/master/ingredients";
import { mapRecipeDbError } from "./errors";
import type { AllergenSummary, OutputUnit, RecipeType, RecipeUnit } from "./types";

// What a recipe screen reads (M7 plan §3.6). Nothing is computed in React: the portion size, the
// allergen state and the warnings are decided here. No cost or margin in euros exists in M7; the
// price fields are the menu price and the target GP% (Q16 = V6), which owner, admin and chef read.

export const PORTIONS_UNIT_DECIMALS = 4;
const MAX_KEYS_PER_SUMMARY = 200;
const PRICE_READERS: readonly AppRole[] = ["owner", "admin", "chef"];
const PRICE_EDITORS: readonly AppRole[] = ["owner", "admin"];
const NOT_FOUND = () => new ApiError(404, "not_found", "Risorsa non trovata.");

export interface KeyRow {
  id: string;
  type: RecipeType;
  is_active: boolean;
  current_version: number;
}

export interface VersionRow {
  id: string;
  version: number;
  valid_from: string;
  name: string;
  output_qty: number | null;
  output_unit: OutputUnit | null;
  portions_per_batch: number | null;
  shelf_life_hours: number | null;
  prep_time_min: number | null;
  min_portions: number | null;
  target_portions: number | null;
}

export interface LineRow {
  position: number;
  ingredient_id: string | null;
  sub_recipe_key: string | null;
  qty: number;
  unit: RecipeUnit;
  yield_factor: number;
}

export interface AllergenRow {
  recipe_key: string;
  allergens: Allergen[];
  confirmed: boolean;
  unconfirmed_ingredient_ids: string[];
}

export interface DetailRows {
  key: KeyRow;
  version: VersionRow;
  versions: { version: number; valid_from: string }[];
  lines: LineRow[];
  /** Ingredient id → name, for the lines and for the unconfirmed list. */
  ingredients: Record<string, string>;
  /** Sub-recipe key → its current name and type. */
  subRecipes: Record<string, { name: string; type: RecipeType }>;
  price: { sale_price: number | null; target_gp_pct: number | null } | null;
  /** Undefined when the summary had no row for the recipe. */
  allergens: AllergenRow | undefined;
}

export type LineWarning = "yield_above_one";

export interface RecipeLine {
  position: number;
  target: { kind: "ingredient" | "recipe"; id: string; name: string; type?: RecipeType };
  qty: number;
  unit: RecipeUnit;
  yieldFactor: number;
  warnings: LineWarning[];
}

export interface RecipeSummary {
  key: string;
  name: string;
  type: RecipeType;
  version: number;
  validFrom: string;
  isActive: boolean;
  allergens: AllergenSummary;
}

export interface RecipeDetail extends RecipeSummary {
  isCurrent: boolean;
  outputQty: number | null;
  outputUnit: OutputUnit | null;
  portionsPerBatch: number | null;
  /** Output quantity per portion, in the output unit; null when the recipe has no portions. */
  portionSize: number | null;
  shelfLifeHours: number | null;
  prepTimeMin: number | null;
  minPortions: number | null;
  targetPortions: number | null;
  lines: RecipeLine[];
  versions: { version: number; validFrom: string }[];
  canEditPrice: boolean;
  canDeactivate: boolean;
  pricing?: { salePrice: number | null; targetGpPct: number | null };
}

const byName = (a: { name: string; id: string }, b: { name: string; id: string }) =>
  a.name.localeCompare(b.name, "it") || a.id.localeCompare(b.id);

/**
 * The allergen state of a recipe. A recipe the summary did not answer for is "da confermare":
 * missing data never reads as allergen-free.
 */
export function buildAllergenSummary(
  row: AllergenRow | undefined,
  names: Record<string, string>,
): AllergenSummary {
  if (!row) return { list: [], status: "da_confermare", unconfirmedIngredients: [] };
  const unconfirmed = row.unconfirmed_ingredient_ids
    .map((id) => ({ id, name: names[id] ?? id }))
    .sort(byName);
  return {
    list: [...row.allergens].sort(),
    status: row.confirmed && unconfirmed.length === 0 ? "confirmed" : "da_confermare",
    unconfirmedIngredients: unconfirmed,
  };
}

function portionSize(version: VersionRow): number | null {
  if (version.output_qty === null || !version.portions_per_batch) return null;
  const factor = 10 ** PORTIONS_UNIT_DECIMALS;
  return Math.round((version.output_qty / version.portions_per_batch) * factor) / factor;
}

function buildLine(line: LineRow, rows: DetailRows): RecipeLine {
  const sub = line.sub_recipe_key ? rows.subRecipes[line.sub_recipe_key] : undefined;
  const target: RecipeLine["target"] = line.sub_recipe_key
    ? {
        kind: "recipe",
        id: line.sub_recipe_key,
        name: sub?.name ?? line.sub_recipe_key,
        ...(sub ? { type: sub.type } : {}),
      }
    : {
        kind: "ingredient",
        id: line.ingredient_id!,
        name: rows.ingredients[line.ingredient_id!] ?? line.ingredient_id!,
      };
  return {
    position: line.position,
    target,
    qty: line.qty,
    unit: line.unit,
    yieldFactor: line.yield_factor,
    warnings: line.yield_factor > 1 ? ["yield_above_one"] : [],
  };
}

/** The pure part of a recipe read: raw rows and the caller's role in, the API shape out. */
export function buildRecipeDetail(rows: DetailRows, role: AppRole): RecipeDetail {
  const { key, version } = rows;
  const isCurrent = version.version === key.current_version;
  const isPlate = key.type === "plate";
  return {
    key: key.id,
    name: version.name,
    type: key.type,
    version: version.version,
    validFrom: version.valid_from,
    isActive: key.is_active,
    allergens: buildAllergenSummary(rows.allergens, rows.ingredients),
    isCurrent,
    outputQty: version.output_qty,
    outputUnit: version.output_unit,
    portionsPerBatch: version.portions_per_batch,
    portionSize: portionSize(version),
    shelfLifeHours: version.shelf_life_hours,
    prepTimeMin: version.prep_time_min,
    minPortions: version.min_portions,
    targetPortions: version.target_portions,
    lines: [...rows.lines].sort((a, b) => a.position - b.position).map((l) => buildLine(l, rows)),
    versions: rows.versions.map((v) => ({ version: v.version, validFrom: v.valid_from })),
    canEditPrice: isPlate && isCurrent && PRICE_EDITORS.includes(role),
    canDeactivate: PRICE_EDITORS.includes(role),
    ...(isPlate && PRICE_READERS.includes(role)
      ? {
          pricing: {
            salePrice: rows.price?.sale_price ?? null,
            targetGpPct: rows.price?.target_gp_pct ?? null,
          },
        }
      : {}),
  };
}

// Loading ------------------------------------------------------------------------------------------

interface QueryResult {
  data: unknown;
  error: { code?: string; message: string; details?: string | null } | null;
}

export function unwrap<T>(result: QueryResult): T {
  if (result.error) throw mapRecipeDbError(result.error);
  return result.data as T;
}

const VERSION_COLUMNS =
  "id, version, valid_from, name, output_qty, output_unit, portions_per_batch, shelf_life_hours, prep_time_min, min_portions, target_portions";

/** The allergen summary rows for these keys, in calls of at most 200 keys (the function's limit). */
export async function loadAllergenRows(
  supabase: SupabaseClient,
  keys: string[],
): Promise<Map<string, AllergenRow>> {
  const found = new Map<string, AllergenRow>();
  for (let i = 0; i < keys.length; i += MAX_KEYS_PER_SUMMARY) {
    const rows = unwrap<AllergenRow[] | null>(
      await supabase.rpc("recipe_allergen_summary", {
        p_keys: keys.slice(i, i + MAX_KEYS_PER_SUMMARY),
      }),
    );
    for (const row of rows ?? []) found.set(row.recipe_key, row);
  }
  return found;
}

/** Ingredient id → name, for ids the caller may read. */
export async function loadIngredientNames(
  supabase: SupabaseClient,
  ids: string[],
): Promise<Record<string, string>> {
  if (ids.length === 0) return {};
  const rows = unwrap<{ id: string; name: string }[] | null>(
    await supabase.from("ingredient").select("id, name").in("id", ids),
  );
  return Object.fromEntries((rows ?? []).map((row) => [row.id, row.name]));
}

/**
 * Reads one recipe version (the current one unless `version` is given) as the caller's RLS shows
 * it. A missing recipe or version, and one the caller may not read, are both 404. The reads run one
 * after the other: a handful of small queries per screen.
 */
export async function loadRecipeDetail(
  supabase: SupabaseClient,
  role: AppRole,
  key: string,
  version?: number,
): Promise<RecipeDetail> {
  const keyRow = unwrap<KeyRow | null>(
    await supabase
      .from("recipe_key")
      .select("id, type, is_active, current_version")
      .eq("id", key)
      .maybeSingle(),
  );
  if (!keyRow) throw NOT_FOUND();
  const versionRow = unwrap<VersionRow | null>(
    await supabase
      .from("recipe")
      .select(VERSION_COLUMNS)
      .eq("recipe_key", key)
      .eq("version", version ?? keyRow.current_version)
      .maybeSingle(),
  );
  if (!versionRow) throw NOT_FOUND();
  const versions = unwrap<DetailRows["versions"] | null>(
    await supabase
      .from("recipe")
      .select("version, valid_from")
      .eq("recipe_key", key)
      .order("version", { ascending: false }),
  );
  const lines =
    unwrap<LineRow[] | null>(
      await supabase
        .from("recipe_line")
        .select("position, ingredient_id, sub_recipe_key, qty, unit, yield_factor")
        .eq("recipe_id", versionRow.id)
        .order("position"),
    ) ?? [];

  const subKeys = lines.flatMap((line) => (line.sub_recipe_key ? [line.sub_recipe_key] : []));
  const subRows =
    subKeys.length === 0
      ? []
      : (unwrap<{ recipe_key: string; name: string; type: RecipeType }[] | null>(
          await supabase
            .from("v_recipe_current")
            .select("recipe_key, name, type")
            .in("recipe_key", subKeys),
        ) ?? []);
  const price =
    keyRow.type === "plate"
      ? unwrap<DetailRows["price"]>(
          await supabase
            .from("recipe_price")
            .select("sale_price, target_gp_pct")
            .eq("recipe_id", versionRow.id)
            .maybeSingle(),
        )
      : null;
  const allergens = (await loadAllergenRows(supabase, [key])).get(key);

  const ingredientIds = [
    ...new Set([
      ...lines.flatMap((line) => (line.ingredient_id ? [line.ingredient_id] : [])),
      ...(allergens?.unconfirmed_ingredient_ids ?? []),
    ]),
  ];
  return buildRecipeDetail(
    {
      key: keyRow,
      version: versionRow,
      versions: versions ?? [],
      lines,
      ingredients: await loadIngredientNames(supabase, ingredientIds),
      subRecipes: Object.fromEntries(
        subRows.map((row) => [row.recipe_key, { name: row.name, type: row.type }]),
      ),
      price,
      allergens,
    },
    role,
  );
}
