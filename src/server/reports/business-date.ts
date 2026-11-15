import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { failReport, parseReport } from "./run";

const businessDate = z.iso.date();

/**
 * A report reply with the venue's current business date added at the top level, so the report page's period picker can set its max without
 * any date maths in the browser (lead, after #134). The business day runs to the tenant's cut-off (02:00 by default, ADR-033), so between 00:00
 * and then it is the previous calendar day; `public.business_date_of` decides it in SQL, where the cut-off lives, as the waste-costs and
 * reconciliation reads do. Only the report routes call this; the CSV exports and the monthly pack read the reports without it. `now` is
 * injectable for tests.
 */
export async function withBusinessDate<T extends object>(
  supabase: SupabaseClient,
  report: T,
  now: Date = new Date(),
): Promise<T & { businessDate: string }> {
  const { data, error } = await supabase.rpc("business_date_of", { p_at: now.toISOString() });
  if (error) failReport("business_date_of", error);
  return { ...report, businessDate: parseReport("business_date_of", businessDate, data) };
}
