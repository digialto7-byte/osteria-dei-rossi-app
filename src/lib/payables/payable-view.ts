import type { BadgeTone } from "@/components/ui";
import { t, type MessageKey } from "@/lib/i18n";
import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n/locale";
import { formatEuro } from "@/lib/money/format";
import { formatCalendarDate, formatDateTime } from "@/lib/time/format";
import type { PatchPayableBody } from "@/server/payables/schemas";
import type {
  PayableHistoryEntry,
  PayableItem,
  PayableStatus,
  PayableTotals,
} from "@/server/payables/types";

// Presentation helpers for the payables screens. Pure: they only word what the API already decided
// (days to the due date, overdue, allowed actions, totals). Nothing here counts days or adds money.

/** Payables are money: owner and admin only (plan §3.11.2). Mirrors the API's role list. */
export const canReadPayables = (role: string): boolean => role === "owner" || role === "admin";

const STATUS_TONE: Record<PayableStatus, BadgeTone> = {
  open: "neutral",
  scheduled: "info",
  paid: "success",
  disputed: "warning",
};

/** The badge tone and its word; the word always says it, colour is only a reinforcement. */
export function statusView(
  status: PayableStatus,
  paidOn: string | null,
  locale: Locale = DEFAULT_LOCALE,
): { tone: BadgeTone; label: string } {
  const label =
    status === "paid" && paidOn
      ? t("payables.status.paidOn", { date: formatCalendarDate(paidOn, locale) }, locale)
      : t(`payables.status.${status}`, {}, locale);
  return { tone: STATUS_TONE[status], label };
}

function plural(
  base: "payables.totals" | "payables.due.in" | "payables.due.late",
  count: number,
  values: Record<string, string | number>,
  locale: Locale,
): string {
  const key = `${base}.${count === 1 ? "one" : "other"}` as MessageKey;
  return t(key, { ...values, count }, locale);
}

/** "Scade il 10/12/2026 (tra 7 giorni)", "Scade oggi", "Scaduta da 3 giorni"; paid: "Scadenza 10/12/2026". */
export function dueLine(
  item: Pick<PayableItem, "dueDate" | "daysToDue" | "status">,
  locale: Locale = DEFAULT_LOCALE,
): string {
  const date = formatCalendarDate(item.dueDate, locale);
  if (item.status === "paid") return t("payables.due.paid", { date }, locale);
  if (item.daysToDue > 0) return plural("payables.due.in", item.daysToDue, { date }, locale);
  if (item.daysToDue === 0) return t("payables.due.today", {}, locale);
  return plural("payables.due.late", -item.daysToDue, {}, locale);
}

/** "Fattura 123/A del 01/12/2026"; a missing number or date is worded, never left blank. */
export function invoiceLine(
  number: string | null,
  date: string | null,
  locale: Locale = DEFAULT_LOCALE,
): string {
  const label = number ?? t("payables.noNumber", {}, locale);
  return date
    ? t("payables.invoiceLine", { number: label, date: formatCalendarDate(date, locale) }, locale)
    : t("payables.invoiceLineNoDate", { number: label }, locale);
}

export const amountText = (amount: number, locale: Locale = DEFAULT_LOCALE) =>
  formatEuro(amount, locale);

/** A credit as a negative amount, "−120,00 €" (a real minus sign); no credit is plain "0,00 €". */
export const creditText = (amount: number, locale: Locale = DEFAULT_LOCALE) =>
  amount > 0 ? `−${formatEuro(amount, locale)}` : formatEuro(0, locale);

/** "4 fatture da pagare · 1.234,50 €" from the server's totals. */
export const totalsLine = (totals: PayableTotals, locale: Locale = DEFAULT_LOCALE) =>
  plural("payables.totals", totals.count, { amount: formatEuro(totals.amount, locale) }, locale);

/** One line of the history: what happened, when it was recorded and by whom. */
export function historyLine(entry: PayableHistoryEntry, locale: Locale = DEFAULT_LOCALE): string {
  let what: string;
  if (entry.action === "created") what = t("payables.history.created", {}, locale);
  else if (entry.action === "payable.payment_reversed")
    what = t("payables.history.reversed", {}, locale);
  else if (entry.toStatus === "open") what = t("payables.history.reopened", {}, locale);
  else if (entry.toStatus) what = statusView(entry.toStatus, entry.paidOn, locale).label;
  else what = "";
  const when = formatDateTime(new Date(entry.at), locale);
  return entry.byName
    ? t("payables.history.line", { what, when, name: entry.byName }, locale)
    : t("payables.history.lineNoName", { what, when }, locale);
}

/** The PATCH body of the status form: the date only for paid, the note only when typed. */
export function buildStatusBody(
  status: PayableStatus,
  input: { paidOn: string; note: string },
): PatchPayableBody {
  const note = input.note.trim();
  return {
    status,
    ...(status === "paid" ? { paidOn: input.paidOn } : {}),
    ...(note ? { reason: note } : {}),
  };
}

/** What the status form holds between saves: the payment date and the optional note. */
export interface StatusFormState {
  paidOn: string;
  note: string;
}

/**
 * The form after a save attempt. A saved note went into the audit trail as an irreversible reason,
 * so a successful save empties it (and resets the date to the server's today) before the next
 * payment; a failed save keeps both so the owner can correct and retry.
 */
export function formAfterSave(
  state: StatusFormState,
  saved: boolean,
  today: string,
): StatusFormState {
  return saved ? { paidOn: today, note: "" } : state;
}
