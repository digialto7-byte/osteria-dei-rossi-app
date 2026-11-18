import type { ServicePeriods } from "@/server/services/output";
import type { ServicesBody } from "@/server/services/schemas";
import { t, tn } from "@/lib/i18n";
import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n/locale";
import { formatEuro } from "@/lib/money/format";
import { formatTime } from "@/lib/time/format";

// Formatting and shaping for the services card (M25c plan §3.1.11): the database computed every window and its end; this file only prints them and
// turns the card's rows into the body of the PATCH. No time arithmetic happens here.

type Period = ServicePeriods["periods"][number];

/** One editable row of the card. A new row has key null. */
export interface ServiceRow {
  key: string | null;
  name: string;
  startsAt: string;
}

/** "16:00–02:00": the start and the end the server sent. */
export function windowLabel(startsAt: string, endsAt: string): string {
  return `${startsAt}–${endsAt}`;
}

/** "Pranzo 11:00–16:00 · Cena 16:00–02:00": the windows of the reply, in its order (the last one ends at the cut-off). */
export function servicesPreview(periods: readonly Period[]): string {
  return periods.map((p) => `${p.name} ${windowLabel(p.startsAt, p.endsAt)}`).join(" · ");
}

/** "Prima delle 11:00 conta come Pranzo. Le modifiche valgono per i tavoli aperti da ora in poi." (the first service of the reply). */
export function servicesHint(periods: readonly Period[]): string {
  const first = periods[0];
  return first ? t("services.hint", { start: first.startsAt, name: first.name }) : "";
}

export function rowsFromPeriods(periods: readonly Period[]): ServiceRow[] {
  return periods.map((p) => ({ key: p.key, name: p.name, startsAt: p.startsAt }));
}

/** The PATCH body in screen order, or null when a name or a start is blank (the server validates the rest). */
export function rowsToBody(rows: readonly ServiceRow[]): ServicesBody | null {
  const periods = rows.map((r) => ({ key: r.key, name: r.name.trim(), startsAt: r.startsAt }));
  if (periods.some((p) => p.name === "" || p.startsAt === "")) return null;
  return { periods };
}

type DayServiceRowInput = {
  name: string;
  tables: number;
  covers: number;
  totalEur: number;
  openTables: number;
};

// Private-use characters stand in for the amount and the name while the message is formatted, so the split never depends on the content.
const AMOUNT_MARK = "\ue000";
const NAME_MARK = "\ue001";

/**
 * The row of a service in three parts, so the card can set only the amount in <strong>: what comes before the amount, the amount, and what
 * follows it (the open-tables words go here). The amount's place comes from the message, so any locale works.
 */
export function dayServiceRowParts(
  service: DayServiceRowInput,
  locale: Locale = DEFAULT_LOCALE,
): { lead: string; amount: string; tail: string } {
  const [lead = "", rest = ""] = t(
    "dayClose.services.row",
    {
      name: NAME_MARK,
      tables: tn("dayClose.tables", service.tables, locale),
      covers: tn("dayClose.covers", service.covers, locale),
      amount: AMOUNT_MARK,
    },
    locale,
  ).split(AMOUNT_MARK);
  const withName = (text: string) => text.replace(NAME_MARK, () => service.name);
  const open =
    service.openTables > 0
      ? ` \u00b7 ${tn("dayClose.services.open", service.openTables, locale)}`
      : "";
  return {
    lead: withName(lead),
    amount: formatEuro(service.totalEur, locale),
    tail: withName(rest) + open,
  };
}

/** "Pranzo · 1 tavolo · 2 coperti · 18,00 €", plus " · 1 tavolo ancora aperto" when some table of the service is still open. */
export function dayServiceRow(service: DayServiceRowInput): string {
  const { lead, amount, tail } = dayServiceRowParts(service);
  return lead + amount + tail;
}

/** "Tavolo 2 (demo) · aperto alle 21:30 · Cena": the opening time in Europe/Rome. */
export function daySessionLine(tableName: string, openedAt: string, serviceName: string): string {
  return t("dayClose.services.session", {
    table: tableName,
    time: formatTime(new Date(openedAt)),
    service: serviceName,
  });
}
