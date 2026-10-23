import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";
import { unwrapCost } from "./errors";
import type { settingsPatchBody } from "./schemas";
import type { CostSettings } from "./types";

const COLUMN = {
  avgCostN: "avg_cost_n",
  priceVariancePct: "price_variance_pct",
  saleVatPct: "sale_vat_pct",
} as const;

function pick(data: CostSettings): CostSettings {
  return {
    avgCostN: data.avgCostN,
    priceVariancePct: data.priceVariancePct,
    saleVatPct: data.saleVatPct,
  };
}

export async function getCostSettings(supabase: SupabaseClient): Promise<CostSettings> {
  return pick(unwrapCost<CostSettings>(await supabase.rpc("cost_settings")));
}

/** The three cost rules; the database checks types and ranges and audits every change. */
export async function updateCostSettings(
  supabase: SupabaseClient,
  patch: z.infer<typeof settingsPatchBody>,
): Promise<CostSettings> {
  const p_patch = Object.fromEntries(
    (Object.keys(COLUMN) as (keyof typeof COLUMN)[]).flatMap((key) =>
      patch[key] === undefined ? [] : [[COLUMN[key], patch[key]]],
    ),
  );
  return pick(unwrapCost<CostSettings>(await supabase.rpc("update_cost_settings", { p_patch })));
}
