import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppRole } from "@/lib/api/with-api";
import { chefPushListOutput, managerPushListOutput } from "./output";
import { failRead, parseRead } from "./read";

/**
 * GET /api/reports/push-list: one RPC, then the strict parse with the schema of the CALLER's role. The owner's and admin's rows carry the cost at
 * risk and the push prices, the chef's cannot: a reply that does not fit its role is a 500 that never reaches the JSON.
 */
export async function getPushList(supabase: SupabaseClient, role: AppRole) {
  const { data, error } = await supabase.rpc("push_list");
  if (error) failRead("push_list", error);
  return parseRead("push_list", role === "chef" ? chefPushListOutput : managerPushListOutput, data);
}
