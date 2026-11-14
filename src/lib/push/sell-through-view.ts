import { formatCount } from "@/lib/batches/batch-view";
import { t } from "@/lib/i18n";
import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n/locale";
import { formatEuro, formatPricePerEtto } from "@/lib/money/format";
import { businessDayTitle } from "@/lib/reports/report-view";
import { formatTime } from "@/lib/time/format";

// Words of "Com'è andata" on Da spingere (P2-2 spec §7.1). Formatting only: the counts, the clipped window and the percent are the API's
// (app.push_sell_through_json); nothing here adds, divides or compares them.

const one = (count: number) => (count === 1 ? "one" : "other");

/** "Venerdì 13 novembre", or "Oggi (in corso)" for a day that is still going. */
export function sellDayTitle(
  day: { businessDate: string; ongoing: boolean },
  locale: Locale = DEFAULT_LOCALE,
): string {
  if (day.ongoing) return t("sell.today", {}, locale);
  const title = businessDayTitle(day.businessDate, locale);
  return title.charAt(0).toUpperCase() + title.slice(1);
}

/** "14 piatti venduti", with "finora" while the push goes on. */
export function platesSoldText(
  push: { ongoing: boolean; plates: { lines: number } },
  locale: Locale = DEFAULT_LOCALE,
): string {
  const text = t(
    `sell.platesSold.${one(push.plates.lines)}`,
    { count: formatCount(push.plates.lines, locale) },
    locale,
  );
  return push.ongoing ? t("sell.sofar", { text }, locale) : text;
}

/** "in evidenza 11:05–02:00", the end being "in corso" while the push goes on. */
export function pushWindowText(
  push: { startedAt: string; endedAt: string; ongoing: boolean },
  locale: Locale = DEFAULT_LOCALE,
): string {
  return t(
    "sell.window",
    {
      from: formatTime(new Date(push.startedAt), locale),
      to: push.ongoing ? t("sell.ongoing", {}, locale) : formatTime(new Date(push.endedAt), locale),
    },
    locale,
  );
}

/** "Prezzo del giorno 12,00 €", per 100 g for a dish sold by weight. */
export function dayPriceText(
  price: number,
  perEtto: boolean,
  locale: Locale = DEFAULT_LOCALE,
): string {
  return t(
    "sell.price",
    { price: perEtto ? formatPricePerEtto(price, locale) : formatEuro(price, locale) },
    locale,
  );
}

export interface AtRiskRow {
  atStart: number;
  soldDuring: number;
  wastedDuring: number;
  otherDuring: number;
  leftAtEnd: number;
  discardedAfter: number;
  sellThroughPct: number | null;
}

/** "10 porzioni in scadenza all'avvio". */
export function atStartText(row: Pick<AtRiskRow, "atStart">, locale: Locale = DEFAULT_LOCALE) {
  return t(`sell.atStart.${one(row.atStart)}`, { count: formatCount(row.atStart, locale) }, locale);
}

/** "8 vendute (80%) · 1 scartata · 1 rimasta", and "altro: −1" when counts or staff meals moved the stock. The percent is the API's. */
export function outcomeLine(row: AtRiskRow, locale: Locale = DEFAULT_LOCALE): string {
  const sold =
    row.sellThroughPct === null
      ? t(
          `sell.sold.${one(row.soldDuring)}`,
          { count: formatCount(row.soldDuring, locale) },
          locale,
        )
      : t(
          `sell.soldPct.${one(row.soldDuring)}`,
          { count: formatCount(row.soldDuring, locale), pct: row.sellThroughPct },
          locale,
        );
  const parts = [
    sold,
    t(
      `sell.wasted.${one(row.wastedDuring)}`,
      { count: formatCount(row.wastedDuring, locale) },
      locale,
    ),
    t(`sell.left.${one(row.leftAtEnd)}`, { count: formatCount(row.leftAtEnd, locale) }, locale),
  ];
  if (row.otherDuring !== 0) {
    const sign = row.otherDuring < 0 ? "−" : "+";
    parts.push(
      t(
        "sell.other",
        { count: `${sign}${formatCount(Math.abs(row.otherDuring), locale)}` },
        locale,
      ),
    );
  }
  return parts.join(" · ");
}

/** "scartate dopo: 1", or null when nothing was discarded afterwards. */
export function discardedAfterText(
  row: Pick<AtRiskRow, "discardedAfter">,
  locale: Locale = DEFAULT_LOCALE,
): string | null {
  return row.discardedAfter === 0
    ? null
    : t("sell.discardedAfter", { count: formatCount(row.discardedAfter, locale) }, locale);
}
