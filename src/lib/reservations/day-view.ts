import type { BadgeTone } from "@/components/ui";
import { isMessageKey, t, tn, type MessageKey } from "@/lib/i18n";
import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n/locale";
import { formatCalendarDate, formatWeekday } from "@/lib/time/format";
import type { ReservationAction } from "@/server/reservations/constants";
import type { SuggestionOption, WaiterReservationRow } from "@/server/reservations/output";
import type { TablePickBody } from "@/server/reservations/schemas";

// Presentation helpers of the Prenotazioni screen. Pure: they only word what the API already decided. The status, the actions, "unito a" and the suggestion are the
// database's; nothing here computes a status, a count, an availability or a table.

/** A row of the day: the waiter's shape, plus `emailStatus` for owner and admin (the waiter's reply has no such key). */
export type RowView = WaiterReservationRow & { emailStatus?: string | null };

/** Counts of one service, as the reply has them. */
export interface Counts {
  reservations: number;
  covers: number;
  pending: number;
}

/** "2 prenotazioni · 6 coperti · 1 da confermare"; the last part is left out when nothing is waiting. */
export function headline(counts: Counts, locale: Locale = DEFAULT_LOCALE): string {
  const parts = [
    tn("reservations.count", counts.reservations, locale),
    tn("reservations.covers", counts.covers, locale),
  ];
  if (counts.pending > 0)
    parts.push(t("reservations.toConfirm", { count: counts.pending }, locale));
  return parts.join(" · ");
}

/** "20:00 · 4 persone · Cliente Demo"; "Dati cancellati" once the customer's data is gone. */
export function rowTitle(row: RowView, locale: Locale = DEFAULT_LOCALE): string {
  return [
    row.time,
    tn("reservations.party", row.party, locale),
    row.name ?? t("reservations.erased", {}, locale),
  ].join(" · ");
}

/** "Tavolo 1 (demo) + Tavolo 2 (demo)"; null when no table is assigned. */
export function tablesLine(row: RowView): string | null {
  return row.tables.length === 0 ? null : row.tables.map((table) => table.name).join(" + ");
}

/** For each table joined to the lead: "Tavolo 2 (demo): unito a Tavolo 1 (demo)". */
export function joinedLines(row: RowView, locale: Locale = DEFAULT_LOCALE): string[] {
  return row.tables.flatMap((table) =>
    table.joinedTo
      ? [t("reservations.joined", { name: table.name, lead: table.joinedTo.name }, locale)]
      : [],
  );
}

/** "Da confermare", "Confermata", ...; an unknown status gets a neutral word, never the raw code. */
export function statusWord(status: string, locale: Locale = DEFAULT_LOCALE): string {
  const key = `reservations.status.${status}`;
  return t(isMessageKey(key) ? key : "reservations.status.unknown", {}, locale);
}

const TONES: Record<string, BadgeTone> = {
  pending: "warning",
  accepted: "info",
  arrived: "success",
  seated: "success",
  declined: "neutral",
  cancelled: "neutral",
  expired: "neutral",
  no_show: "danger",
};

/** The tone reinforces the word; it never carries the meaning alone. */
export function statusTone(status: string): BadgeTone {
  return Object.hasOwn(TONES, status) ? TONES[status]! : "neutral";
}

/** The label of a button, for an action the database listed. */
export function actionLabel(action: ReservationAction, locale: Locale = DEFAULT_LOCALE): string {
  return t(`reservations.action.${action}` as MessageKey, {}, locale);
}

/** What the outbox did with the customer's e-mail ("E-mail inviata"); null for no status or one that is not known. */
export function emailWord(
  status: string | null | undefined,
  locale: Locale = DEFAULT_LOCALE,
): string | null {
  if (!status) return null;
  const key = `reservations.email.${status}`;
  return isMessageKey(key) ? t(key, {}, locale) : null;
}

/** "Tavolo 2 (demo), 4 posti"; for a group "Tavoli 1+2: Tavolo 1 (demo) + Tavolo 2 (demo), 6 posti". */
export function optionLabel(option: SuggestionOption, locale: Locale = DEFAULT_LOCALE): string {
  const names = option.tables.map((table) => table.name).join(" + ");
  const seats = tn("reservations.seats", option.seats, locale);
  return option.groupName
    ? t("reservations.option.group", { group: option.groupName, tables: names, seats }, locale)
    : t("reservations.option.table", { tables: names, seats }, locale);
}

/** The body of accept (or of an assignment) for a suggested table or group. */
export const pickOf = (option: SuggestionOption): TablePickBody => ({
  tableIds: option.tableIds,
  groupId: option.groupId,
});

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A `?data=` value that is a real calendar date, else null (the page then shows today's business day). */
export function dateFromQuery(value: string | null): string | null {
  if (value === null || !DATE.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : value;
}

/** "ven 20/11/2026": the short weekday and the date, as a calendar date (no zone moves it). */
export const dayHeading = (date: string, locale: Locale = DEFAULT_LOCALE): string =>
  `${formatWeekday(date, locale)} ${formatCalendarDate(date, locale)}`;
