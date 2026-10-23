import type { BadgeTone } from "@/components/ui";
import { t } from "@/lib/i18n";
import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n/locale";
import { formatTime } from "@/lib/time/format";
import { roleWord } from "./pin-view";

// Presentation helpers for /personale. Pure. By decision (project Q10) nothing here words a login or
// logout time of a person: the only time is when a lock ends.

/** One row of GET /api/users. */
export interface StaffItem {
  id: string;
  displayName: string;
  role: "chef" | "waiter";
  loginMethod: "email" | "pin";
  active: boolean;
  lockedUntil: string | null;
}

/** Staff, PINs and devices are managed by owner and admin (plan §3.7). Mirrors the API's role list. */
export const canManageStaff = (role: string): boolean => role === "owner" || role === "admin";

export function staffBadges(
  item: StaffItem,
  locale: Locale = DEFAULT_LOCALE,
): { tone: BadgeTone; label: string }[] {
  const badges: { tone: BadgeTone; label: string }[] = [
    { tone: "neutral", label: roleWord(item.role, locale) },
  ];
  if (!item.active) {
    badges.push({ tone: "neutral", label: t("staff.inactive", {}, locale) });
  } else if (item.lockedUntil) {
    badges.push({
      tone: "warning",
      label: t("staff.locked", { time: formatTime(new Date(item.lockedUntil), locale) }, locale),
    });
  }
  if (item.loginMethod === "email") {
    badges.push({ tone: "info", label: t("staff.emailLogin", {}, locale) });
  }
  return badges;
}

/** Which actions a row offers. A PIN needs an active account that signs in with one. */
export function staffActions(item: StaffItem): {
  pin: boolean;
  toggle: "deactivate" | "reactivate";
  role: boolean;
} {
  return {
    pin: item.active && item.loginMethod === "pin",
    toggle: item.active ? "deactivate" : "reactivate",
    role: true,
  };
}

export const otherRole = (role: StaffItem["role"]): StaffItem["role"] =>
  role === "chef" ? "waiter" : "chef";
