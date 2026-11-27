import type { MessageKey } from "@/lib/i18n";

/** The message for a code `switchTenant` returned (SP2 S10). Offline and "too soon" have their own line; every other code is the one generic failure. */
export function switchMessageKey(code: string): MessageKey {
  if (code === "offline") return "tenantSwitch.offline";
  if (code === "tenant_switch_too_soon") return "tenantSwitch.tooSoon";
  return "tenantSwitch.failed";
}
