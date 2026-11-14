import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppRole } from "@/lib/api/with-api";
import { failRead, parseRead } from "./errors";
import { traceLineSearchOutput, traceOrderLineChefOutput, traceOrderLineOutput } from "./output";
import type { TraceLinesQuery } from "./schemas";

/** GET /api/trace/lines: the lines fired on a business day, optionally of one dish. */
export async function searchLines(supabase: SupabaseClient, query: TraceLinesQuery) {
  const { data, error } = await supabase.rpc("trace_line_search", {
    p_date: query.date,
    p_menu_item: query.menuItemId ?? null,
  });
  if (error) failRead("trace_line_search", error);
  return parseRead("trace_line_search", traceLineSearchOutput, data);
}

/** GET /api/trace/lines/:id: the backward trace of a served plate. */
export async function getLineTrace(supabase: SupabaseClient, role: AppRole, id: string) {
  const { data, error } = await supabase.rpc("trace_order_line", { p_line: id });
  if (error) failRead("trace_order_line", error);
  return parseRead(
    "trace_order_line",
    role === "chef" ? traceOrderLineChefOutput : traceOrderLineOutput,
    data,
  );
}
