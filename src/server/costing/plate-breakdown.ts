import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { ApiError } from "@/lib/api/errors";
import type { AppRole } from "@/lib/api/with-api";
import { t } from "@/lib/i18n";
import { reportError } from "@/lib/observability/report";
import { unwrapCost } from "./errors";
import { namedIngredients } from "./names";

// GET /api/costs/plates/:key (UX plan P1-10): one plate's cost split by line. The document is built by
// public.plate_breakdown(); here it is checked, key by key and strictly, against the shape for the caller's role, so a
// euro key that reached the chef's document by mistake is a 500, not a leak (V6). Strict objects: an unknown key fails.

const number = z.number().nullable();
const target = z.strictObject({
  kind: z.enum(["ingredient", "recipe"]),
  id: z.string(),
  name: z.string(),
});
const lineBase = {
  position: z.number().int(),
  target,
  /** Percent of the plate's cost, null when the plate's cost is unknown or the line is unpriced. */
  sharePct: number,
  incomplete: z.boolean(),
  /** The cost screen's reason code for an unpriced line. */
  reason: z.string().nullable(),
};
const coreFields = {
  recipeKey: z.string(),
  name: z.string(),
  version: z.number().int(),
  at: z.string().nullable(),
  status: z.enum(["ok", "below_target", "incomplete"]),
  incomplete: z.boolean(),
  reasons: z.array(z.string()),
  foodCostPct: number,
  gpPct: number,
  targetGpPct: number,
};
const money = z.strictObject({
  foodCostEur: number,
  salePriceExVatEur: number,
  grossMarginEur: number,
});

// What the function returns, by role.
const ownerDocument = z.strictObject({
  ...coreFields,
  missingIngredientIds: z.array(z.string()),
  lines: z.array(z.strictObject({ ...lineBase, lineCostEur: number })),
  money,
});
const chefDocument = z.strictObject({
  ...coreFields,
  missingIngredientIds: z.array(z.string()),
  lines: z.array(z.strictObject(lineBase)),
});

// What the API returns: the same, with the missing ingredients named.
const missing = z.array(z.strictObject({ id: z.string(), name: z.string() }));
const ownerBreakdown = z.strictObject({
  ...coreFields,
  missingIngredients: missing,
  lines: z.array(z.strictObject({ ...lineBase, lineCostEur: number })),
  money,
});
const chefBreakdown = z.strictObject({
  ...coreFields,
  missingIngredients: missing,
  lines: z.array(z.strictObject(lineBase)),
});

export type OwnerPlateBreakdown = z.infer<typeof ownerBreakdown>;
export type ChefPlateBreakdown = z.infer<typeof chefBreakdown>;
export type PlateBreakdown = OwnerPlateBreakdown | ChefPlateBreakdown;

/** The response schema for the owner (and admin) or the chef. */
export const breakdownSchema = (kind: "owner" | "chef") =>
  kind === "chef" ? chefBreakdown : ownerBreakdown;

const unavailable = () => new ApiError(500, "cost_unavailable", t("costError.unavailable"));

/** One plate's breakdown on a day (null = now), shaped for the role. The waiter never gets here (the route refuses). */
export async function getPlateBreakdown(
  supabase: SupabaseClient,
  role: AppRole,
  key: string,
  at: string | null,
): Promise<PlateBreakdown> {
  const doc = unwrapCost<unknown>(
    await supabase.rpc("plate_breakdown", { p_key: key, p_date: at }),
  );
  const parsed = (role === "chef" ? chefDocument : ownerDocument).safeParse(doc);
  if (!parsed.success) {
    // The message names the shape problem only, never a value.
    reportError(new Error(`plate_breakdown shape: ${parsed.error.issues[0]?.code ?? "invalid"}`));
    throw unavailable();
  }
  const { missingIngredientIds, ...rest } = parsed.data;
  return { ...rest, missingIngredients: await namedIngredients(supabase, missingIngredientIds) };
}
