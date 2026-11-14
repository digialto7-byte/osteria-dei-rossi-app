import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppRole } from "@/lib/api/with-api";
import { pushSellThroughChefOutput, pushSellThroughOutput } from "./output";
import { failRead, parseRead } from "./read";
import type { SellThroughQuery } from "./schemas";

/**
 * GET /api/reports/push-sell-through: one RPC, then the strict parse with the schema of the CALLER's role (the chef's has no `pushPrice`). No date
 * means yesterday's business date, which the database picks.
 */
export async function getPushSellThrough(
  supabase: SupabaseClient,
  role: AppRole,
  query: SellThroughQuery,
) {
  const { data, error } = await supabase.rpc("push_sell_through", { p_date: query.date ?? null });
  if (error) failRead("push_sell_through", error);
  return parseRead(
    "push_sell_through",
    role === "chef" ? pushSellThroughChefOutput : pushSellThroughOutput,
    data,
  );
}
