import type { BadgeTone } from "@/components/ui";
import { t } from "@/lib/i18n";
import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n/locale";
import { formatCalendarDate, formatDateTime, formatTime } from "@/lib/time/format";
import { venueDate } from "@/lib/time/venue-date";
import type { DeviceStatus } from "@/server/staff-auth/types";

// Presentation helpers for /dispositivi. Pure: the status and times come from the API. A device shows its
// own last use, never which person it was (project Q10).

const STATUS_TONE: Record<DeviceStatus, BadgeTone> = {
  attivo: "success",
  bloccato: "warning",
  revocato: "neutral",
};

export function deviceStatusView(
  status: DeviceStatus,
  locale: Locale = DEFAULT_LOCALE,
): { tone: BadgeTone; label: string } {
  return { tone: STATUS_TONE[status], label: t(`devices.status.${status}`, {}, locale) };
}

/** "Abilitato il 24/10/2026 · ultimo accesso 24/10/2026 19:02" (Europe/Rome). */
export function deviceMeta(
  device: { enrolledAt: string; lastLoginAt: string | null },
  locale: Locale = DEFAULT_LOCALE,
): string {
  const enrolled = formatCalendarDate(venueDate(new Date(device.enrolledAt)), locale);
  if (!device.lastLoginAt) return t("devices.metaNever", { enrolled }, locale);
  const last = formatDateTime(new Date(device.lastLoginAt), locale).replace(", ", " ");
  return t("devices.meta", { enrolled, last }, locale);
}

export function deviceActions(status: DeviceStatus): { unlock: boolean; revoke: boolean } {
  return { unlock: status === "bloccato", revoke: status !== "revocato" };
}

export function codeExpiryLine(expiresAt: string, locale: Locale = DEFAULT_LOCALE): string {
  return t("devices.codeExpires", { time: formatTime(new Date(expiresAt), locale) }, locale);
}

/** A pending code is listed by its device name and expiry; the code itself is never shown again. */
export function pendingCodeLine(
  code: { label: string; expiresAt: string },
  locale: Locale = DEFAULT_LOCALE,
): string {
  return t(
    "devices.pendingLine",
    { label: code.label, time: formatTime(new Date(code.expiresAt), locale) },
    locale,
  );
}

export function revokeConfirmText(label: string, locale: Locale = DEFAULT_LOCALE): string {
  return t("devices.revokeConfirm", { label }, locale);
}
