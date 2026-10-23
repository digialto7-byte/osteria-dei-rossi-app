import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { AppRole } from "@/lib/api/with-api";
import type { Locale } from "@/lib/i18n/locale";
import { mapAlertError } from "./errors";
import { getAlert, type AlertItem } from "./list";

export const testAlertBody = z.object({ includeKitchen: z.boolean().optional() });
export type TestAlertBody = z.infer<typeof testAlertBody>;

export interface TestAlertResult {
  alert: AlertItem;
  /** True when today's test alert of this kind already existed (one per kind, tenant and day). */
  deduplicated: boolean;
}

/** The owner's "check that alerts work" button; `raise_test_alert` is owner only. */
export async function raiseTestAlert(
  supabase: SupabaseClient,
  body: TestAlertBody,
  role: AppRole,
  locale: Locale,
): Promise<TestAlertResult> {
  const { data, error } = await supabase.rpc("raise_test_alert", {
    p_include_kitchen: body.includeKitchen ?? false,
  });
  if (error) throw mapAlertError(error);
  const raised = data as { alertId: string; inserted: boolean };
  return {
    alert: await getAlert(supabase, raised.alertId, role, locale),
    deduplicated: !raised.inserted,
  };
}
