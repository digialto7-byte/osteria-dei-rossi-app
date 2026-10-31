import { t, type MessageKey } from "@/lib/i18n";
import { DEFAULT_LOCALE, INTL_LOCALE, type Locale } from "@/lib/i18n/locale";
import { formatEuro } from "@/lib/money/format";
import { formatCalendarDate, formatWeekday, formatWeekdayTime } from "@/lib/time/format";
import { formatNumber } from "@/lib/units/format";
import type { PushListRow } from "@/server/push/output";

// Pure helpers of the push list, the "Da spingere oggi" tile and the forecast panel (M23 plan §3.1.9, §3.5). They only format and pick labels: the
// database computed every quantity, hour, sum, average, gap, date, flag and order.

export type PushRole = "owner" | "admin" | "chef";

const oneDecimalFormatters = new Map<Locale, Intl.NumberFormat>();
/** At most one decimal: "22", "22,3". */
export function formatOneDecimal(value: number, locale: Locale = DEFAULT_LOCALE): string {
  let formatter = oneDecimalFormatters.get(locale);
  if (!formatter) {
    formatter = new Intl.NumberFormat(INTL_LOCALE[locale], { maximumFractionDigits: 1 });
    oneDecimalFormatters.set(locale, formatter);
  }
  return formatter.format(value);
}

/** The `.one` form when the number is exactly 1, else `.other`; `{count}` is the number as it is shown, the other placeholders are `values`. */
function plural(
  base: string,
  count: number,
  shown: string,
  locale: Locale,
  values: Record<string, string> = {},
): string {
  return t(
    `${base}.${count === 1 ? "one" : "other"}` as MessageKey,
    { ...values, count: shown },
    locale,
  );
}

function portions(count: number, locale: Locale): string {
  return plural("dashboard.stock.portions", count, formatNumber(count, locale), locale);
}

/**
 * "Spezzatino, prodotto lun, da consumare entro mer 20:00, 14 porzioni, 38,00 € a rischio → spingi Spezzatino con polenta". The chef's sentence has no
 * amount; an unknown cost says "costo non noto". A lot says when it arrived and when it expires; where the plates are not direct, it names the batch
 * recipes that use it ("usato in Spezzatino").
 */
export function pushLine(
  row: PushListRow,
  role: PushRole,
  locale: Locale = DEFAULT_LOCALE,
): string {
  const parts: string[] = [row.name];
  if (row.kind === "batch") {
    parts.push(t("push.line.madeOn", { day: formatWeekday(row.madeOn, locale) }, locale));
    parts.push(
      t("push.line.useBy", { when: formatWeekdayTime(new Date(row.useByAt), locale) }, locale),
    );
    parts.push(portions(row.quantity, locale));
  } else {
    parts.push(t("push.line.arrivedOn", { day: formatWeekday(row.madeOn, locale) }, locale));
    if (row.expiryDate) {
      parts.push(t("push.line.expires", { day: formatWeekday(row.expiryDate, locale) }, locale));
    }
    parts.push(`${formatNumber(row.quantity, locale)} ${row.unit}`);
  }
  if (role !== "chef" && "costAtRiskEur" in row) {
    parts.push(
      row.costAtRiskEur === null
        ? t("push.line.costUnknown", {}, locale)
        : t("push.line.atRisk", { amount: formatEuro(row.costAtRiskEur, locale) }, locale),
    );
  }
  const text = parts.join(", ");
  const targets: string[] = [];
  if (row.plates.length > 0) {
    targets.push(
      t("push.line.pushPlates", { names: row.plates.map((p) => p.name).join(", ") }, locale),
    );
  }
  if (row.batchRecipes.length > 0) {
    targets.push(
      t("push.line.usedIn", { names: row.batchRecipes.map((r) => r.name).join(", ") }, locale),
    );
  }
  return targets.length > 0 ? `${text} → ${targets.join("; ")}` : text;
}

/** "★ in evidenza" for a plate that is pushed now, else null. */
export function pushedPlateText(pushed: boolean, locale: Locale = DEFAULT_LOCALE): string | null {
  return pushed ? t("push.starred", {}, locale) : null;
}

/** "tra 4 h", "tra 30 min": the hours left are the database's; under one hour they are shown as minutes. */
export function hoursBadge(hours: number, locale: Locale = DEFAULT_LOCALE): string {
  if (hours < 1) {
    return t("push.badge.minutes", { count: Math.floor(hours * 60) }, locale);
  }
  return t("push.badge.hours", { count: formatOneDecimal(hours, locale) }, locale);
}

const longWeekdays = new Map<Locale, Intl.DateTimeFormat>();
/** The weekday as the sentence of the locale wants it: long in Italian ("il giovedì"), short in English ("Thu"). */
function forecastWeekday(isoDate: string, locale: Locale): string {
  formatCalendarDate(isoDate, locale); // refuses a date that is not real
  if (locale !== "it") return formatWeekday(isoDate, locale).replace(/\.$/, "");
  let formatter = longWeekdays.get(locale);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(INTL_LOCALE[locale], { timeZone: "UTC", weekday: "long" });
    longWeekdays.set(locale, formatter);
  }
  return formatter.format(new Date(`${isoDate}T00:00:00Z`));
}

export type ForecastLineInput = {
  date: string;
  name: string;
  expected: number | null;
  onHand: number;
};

/** "Di solito il giovedì escono 22 porzioni di Spezzatino; ne hai 14", or the empty text when no week has sales. */
export function forecastLine(input: ForecastLineInput, locale: Locale = DEFAULT_LOCALE): string {
  const weekday = forecastWeekday(input.date, locale);
  if (input.expected === null) return t("forecast.empty", {}, locale);
  return plural("forecast.line", input.expected, formatOneDecimal(input.expected, locale), locale, {
    weekday,
    name: input.name,
    onHand: formatOneDecimal(input.onHand, locale),
  });
}

/** "ne mancano 8", or null when nothing is short (or the gap is unknown). */
export function shortfallBadge(gap: number | null, locale: Locale = DEFAULT_LOCALE): string | null {
  if (gap === null || gap <= 0) return null;
  return plural("forecast.short", gap, formatOneDecimal(gap, locale), locale);
}

/** "Coperti attesi: 31": the expected covers of the forecast (owner and admin only; the chef's reply has none). */
export function coversLine(expected: number, locale: Locale = DEFAULT_LOCALE): string {
  return t("forecast.covers", { count: formatOneDecimal(expected, locale) }, locale);
}
