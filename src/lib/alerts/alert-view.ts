import type { BadgeTone } from "@/components/ui";
import { t } from "@/lib/i18n";
import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n/locale";
import { formatDateTime } from "@/lib/time/format";

// Presentation helpers for /avvisi. Pure: they only word what the API already decided (severity,
// acknowledgement, text). No data logic here, and no amounts: the server renders the text.

export type AlertSeverity = "info" | "warning" | "critical";

const SEVERITY_TONE: Record<AlertSeverity, BadgeTone> = {
  info: "info",
  warning: "warning",
  critical: "danger",
};

/** The badge tone and its word; the word always says it, colour is only a reinforcement. */
export function severityView(
  severity: AlertSeverity,
  locale: Locale = DEFAULT_LOCALE,
): { tone: BadgeTone; label: string } {
  return { tone: SEVERITY_TONE[severity], label: t(`alerts.severity.${severity}`, {}, locale) };
}

/** "Visto il 25/10/2026, 09:12 da Titolare Demo"; the name is left out when the server sent none. */
export function ackLine(
  acknowledged: { at: string; byName: string | null },
  locale: Locale = DEFAULT_LOCALE,
): string {
  const date = formatDateTime(new Date(acknowledged.at), locale);
  return acknowledged.byName
    ? t("alerts.ack.lineBy", { date, name: acknowledged.byName }, locale)
    : t("alerts.ack.line", { date }, locale);
}

/** "del 25/10/2026, 02:30": when the alert was raised, in Europe/Rome. */
export function alertMeta(createdAt: string, locale: Locale = DEFAULT_LOCALE): string {
  return t("alerts.meta", { date: formatDateTime(new Date(createdAt), locale) }, locale);
}

/** Roles that read alerts (founder, 2026-10-23): the owner, and the chef for kitchen alerts. */
export function canReadAlerts(role: string): boolean {
  return role === "owner" || role === "chef";
}
