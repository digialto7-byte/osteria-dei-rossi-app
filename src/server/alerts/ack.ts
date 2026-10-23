import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppRole } from "@/lib/api/with-api";
import type { Locale } from "@/lib/i18n/locale";
import { mapAlertError } from "./errors";
import { getAlert, type AlertItem } from "./list";

/**
 * One tap on "Ho visto". `acknowledge_alert` checks the role and that the caller can read the alert,
 * sets the acknowledgement once and returns the first one on a repeat, so this is idempotent. The
 * refreshed item is read back under the caller's own RLS.
 */
export async function acknowledgeAlert(
  supabase: SupabaseClient,
  id: string,
  role: AppRole,
  locale: Locale,
): Promise<AlertItem> {
  const { error } = await supabase.rpc("acknowledge_alert", { p_alert: id });
  if (error) throw mapAlertError(error);
  return getAlert(supabase, id, role, locale);
}
