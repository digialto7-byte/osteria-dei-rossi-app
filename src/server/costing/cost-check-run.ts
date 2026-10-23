import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";
import { ApiError } from "@/lib/api/errors";
import { venueDate } from "@/lib/time/venue-date";
import { MAX_COST_CHECK_CHARS } from "./constants";
import { compareCostCheck, type CostCheckResult } from "./cost-check";
import { costCheckRowsFromCsv, costCheckRowsFromJson } from "./cost-check-template";
import { unwrapCost } from "./errors";
import type { costCheckBody } from "./schemas";

export interface CostCheckResponse extends CostCheckResult {
  at: string;
}

/**
 * Gate 1 (AT9): the chef's sheet against the app's current food cost per plate. The sheet is read
 * and checked first (row errors are a 422 with rows and codes, never cell contents); only then is
 * plate_costs read, once. Nothing is stored. `now` is injected for the date in the answer.
 */
export async function runCostCheck(
  supabase: SupabaseClient,
  body: z.infer<typeof costCheckBody>,
  now: Date = new Date(),
): Promise<CostCheckResponse> {
  if (body.format === "csv" && body.csv.length > MAX_COST_CHECK_CHARS) {
    throw new ApiError(413, "payload_too_large", "Il foglio è troppo grande.");
  }
  const mapped =
    body.format === "csv" ? costCheckRowsFromCsv(body.csv) : costCheckRowsFromJson(body.plates);
  if (mapped.errors.length > 0) {
    throw new ApiError(
      422,
      "import_invalid",
      "Il foglio contiene righe non valide.",
      mapped.errors,
    );
  }
  const rows =
    unwrapCost<{ recipe_key: string; name: string; food_cost_eur: number | null }[] | null>(
      await supabase.rpc("plate_costs", { p_date: null }),
    ) ?? [];
  const result = compareCostCheck(
    mapped.rows,
    rows.map((row) => ({
      recipeKey: row.recipe_key,
      name: row.name,
      foodCostEur: row.food_cost_eur,
    })),
  );
  return { at: venueDate(now), ...result };
}
