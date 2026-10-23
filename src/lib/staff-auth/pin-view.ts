import { t } from "@/lib/i18n";
import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n/locale";
import { formatTime } from "@/lib/time/format";

// Presentation helpers for the PIN screen. Pure: they word what /api/auth/device and /api/auth/pin
// already decided (locks, attempts left). No counting and no lock rule here; those live in Postgres.

export interface StaffEntry {
  id: string;
  displayName: string;
  role: "chef" | "waiter";
}

/** GET /api/auth/device. */
export type DeviceReply =
  { enrolled: false } | { enrolled: true; label: string; locked: boolean; staff: StaffEntry[] };

export type DeviceScreen =
  | { kind: "not_enrolled" }
  | { kind: "locked" }
  | { kind: "ready"; label: string; staff: StaffEntry[] };

export function deviceScreen(reply: DeviceReply): DeviceScreen {
  if (!reply.enrolled) return { kind: "not_enrolled" };
  if (reply.locked) return { kind: "locked" };
  return { kind: "ready", label: reply.label, staff: reply.staff };
}

export function roleWord(role: StaffEntry["role"], locale: Locale = DEFAULT_LOCALE): string {
  return t(`pin.role.${role}`, {}, locale);
}

interface ApiErrorLike {
  code: string;
  details?: Record<string, string | number>[];
}

export interface LoginFeedback {
  /** retry: stay on the PIN pad; user_locked / locked: the way in is closed; not_enrolled: start over. */
  kind: "retry" | "user_locked" | "locked" | "not_enrolled";
  message: string;
}

/** The text for an answer of POST /api/auth/pin. The server's own message is never shown. */
export function loginFeedback(error: ApiErrorLike, locale: Locale = DEFAULT_LOCALE): LoginFeedback {
  const detail = error.details?.[0];
  switch (error.code) {
    case "pin_invalid": {
      const left = detail?.attemptsLeft;
      return {
        kind: "retry",
        message:
          typeof left === "number"
            ? t("pin.invalid", { count: left }, locale)
            : t("staffAuthError.pin_invalid", {}, locale),
      };
    }
    case "user_locked": {
      const until = new Date(String(detail?.lockedUntil ?? ""));
      return {
        kind: "user_locked",
        message: Number.isNaN(until.getTime())
          ? t("staffAuthError.user_locked", {}, locale)
          : t("pin.userLocked", { time: formatTime(until, locale) }, locale),
      };
    }
    case "device_locked":
      return { kind: "locked", message: t("staffAuthError.device_locked", {}, locale) };
    case "device_revoked":
    case "device_unknown":
    case "device_missing":
      return { kind: "not_enrolled", message: t("pin.notEnrolled", {}, locale) };
    case "attempt_in_progress":
      return { kind: "retry", message: t("pin.inProgress", {}, locale) };
    default:
      return { kind: "retry", message: t("pin.unavailable", {}, locale) };
  }
}

/** Keeps the digits a person typed, at most four. */
export function sanitizePin(value: string): string {
  return value.replace(/[^0-9]/g, "").slice(0, 4);
}

export function isCompletePin(value: string): boolean {
  return /^[0-9]{4}$/.test(value);
}
