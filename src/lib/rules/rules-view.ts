import { isMessageKey, t, type MessageKey } from "@/lib/i18n";
import { parseDecimal, type DecimalResult } from "@/lib/numbers/parse-decimal";
import { RULES_LEVEL_MAX } from "@/server/rules/constants";
import { DEFAULT_LOCALE, INTL_LOCALE, type Locale } from "@/lib/i18n/locale";
import { formatWeekday, VENUE_TIME_ZONE } from "@/lib/time/format";

// Presentation helpers for the reorder, prep and purchase rule screens. Pure: they only word what the API already
// decided; nothing here computes a window, a status or a quantity. The role lists mirror the routes.

/** Owner, admin and chef read the rules; the waiter has no access. Mirrors the API's role list. */
export const canReadRules = (role: string): boolean =>
  role === "owner" || role === "admin" || role === "chef";

/** Only owner and admin change the rules. Mirrors the API's role list. */
export const canEditRules = (role: string): boolean => role === "owner" || role === "admin";

/** The word for a reason an ingredient is incomplete; an unknown reason gets a neutral word, never the raw code. */
export function reasonWord(reason: string, locale: Locale = DEFAULT_LOCALE): string {
  const key = `rules.reason.${reason}`;
  return t(isMessageKey(key) ? key : "rules.reason.unknown", {}, locale);
}

/** "dalla ricetta v3" for a value that comes from the recipe version; null for a rule value or no value. */
export function sourceHint(
  source: string | null,
  version: number,
  locale: Locale = DEFAULT_LOCALE,
): string | null {
  return source === "version" ? t("rules.sourceVersion", { version }, locale) : null;
}

/** The seven ISO weekdays (1 = Monday) with their short labels, Monday first. */
export function weekdayLabels(locale: Locale = DEFAULT_LOCALE): { value: number; label: string }[] {
  return [1, 2, 3, 4, 5, 6, 7].map((value) => ({
    value,
    label: t(`rules.weekday.${value}` as MessageKey, {}, locale),
  }));
}

const orderByFormatters = new Map<Locale, Intl.DateTimeFormat>();

// "mar 03/11, 11:00" in venue time: short weekday, day/month, then the clock time.
function formatOrderBy(instant: Date, locale: Locale): string {
  let formatter = orderByFormatters.get(locale);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(INTL_LOCALE[locale], {
      timeZone: VENUE_TIME_ZONE,
      weekday: "short",
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    orderByFormatters.set(locale, formatter);
  }
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    formatter.formatToParts(instant).find((p) => p.type === type)?.value ?? "";
  return `${part("weekday")} ${part("day")}/${part("month")}, ${part("hour")}:${part("minute")}`;
}

/**
 * "Prossimo ordine entro mar 03/11, 11:00 · consegna gio 05/11" from the server's window. The window is shown as
 * given: the order-by instant in Europe/Rome and the delivery as a calendar date, with no arithmetic between them.
 */
export function nextWindowLine(
  window: { deliveryDate: string; orderByAt: string } | null,
  locale: Locale = DEFAULT_LOCALE,
): string | null {
  if (!window) return null;
  const [, month, day] = window.deliveryDate.split("-");
  return t(
    "rules.nextWindow",
    {
      orderBy: formatOrderBy(new Date(window.orderByAt), locale),
      delivery: `${formatWeekday(window.deliveryDate, locale)} ${day}/${month}`,
    },
    locale,
  );
}

/**
 * What was typed in a level field: empty clears the rule, digits with an optional comma or dot and at most 4 decimals
 * are a quantity (0 included), anything else is not ok. The ceiling mirrors the API; the rest is the server's.
 */
export function parseLevelInput(text: string): DecimalResult {
  const parsed = parseDecimal(text);
  return parsed.ok && parsed.value !== null && parsed.value > RULES_LEVEL_MAX
    ? { ok: false }
    : parsed;
}

/** What was typed in a whole-number field (days, portions, minutes): empty clears the rule; no sign, no decimals. */
export function parseWholeInput(text: string, max: number): DecimalResult {
  const trimmed = text.trim();
  if (trimmed === "") return { ok: true, value: null };
  if (!/^\d{1,6}$/.test(trimmed)) return { ok: false };
  const value = Number(trimmed);
  return value > max ? { ok: false } : { ok: true, value };
}

/** "Lun, Gio" for the delivery days (Monday first); a dash for none. */
export function weekdayList(days: readonly number[], locale: Locale = DEFAULT_LOCALE): string {
  const labels = weekdayLabels(locale);
  const names = labels.filter((day) => days.includes(day.value)).map((day) => day.label);
  return names.length > 0 ? names.join(", ") : t("rules.none", {}, locale);
}

/** "Macelleria X (demo) · confezione 5 kg": one option of the preferred-supplier select. */
export function choiceLabel(
  choice: { supplierName: string; packLabel: string },
  locale: Locale = DEFAULT_LOCALE,
): string {
  return t("rules.pack", { supplier: choice.supplierName, pack: choice.packLabel }, locale);
}

/** How many ingredients the server marked incomplete, for the count on the Riordino home. */
export function incompleteCount(items: readonly { status: string }[]): number {
  return items.filter((item) => item.status === "incomplete").length;
}
