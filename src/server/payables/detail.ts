import type { SupabaseClient } from "@supabase/supabase-js";
import { venueDate } from "@/lib/time/venue-date";
import { mapPayableDbError } from "./errors";
import type { PayableDetail } from "./types";

/**
 * One payable with its allowed actions and history, as public.payable_detail builds them, plus the
 * venue's today (the form's default payment date; `now` is injectable for tests).
 */
export async function getPayableDetail(
  supabase: SupabaseClient,
  id: string,
  now: Date = new Date(),
): Promise<PayableDetail> {
  const { data, error } = await supabase.rpc("payable_detail", { p_payable: id });
  if (error) throw mapPayableDbError(error);
  return { ...(data as Omit<PayableDetail, "today">), today: venueDate(now) };
}
