import { t } from "@/lib/i18n";
import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n/locale";
import { formatTime } from "@/lib/time/format";
import { courseLabel } from "@/lib/orders/order-view";
import { KITCHEN_TAP_GUARD_MS } from "@/server/kitchen/constants";
import type { KitchenLine, KitchenTicket } from "@/server/kitchen/output";
import type { MarkTicketBody } from "@/server/kitchen/schemas";
import { firedLine } from "./kitchen-view";

// Words and request bodies for the kitchen done marks (M19b plan §3.6). Pure. The numbers (counts, remaining) come from the API; these
// helpers only word them, so no arithmetic over ticket data happens in React.

export interface TapState {
  /** A request for this row is on its way. */
  pending: boolean;
  /** `Date.now()` of the row's last change on this screen, or null. */
  lastChangeAt: number | null;
  now: number;
}

/**
 * The state a tap on a dish row asks for, or null when the tap is ignored: the row is voided, a request is pending, or the last change
 * was less than KITCHEN_TAP_GUARD_MS ago (so a double tap never reads as "mark, then undo").
 */
export function markIntent(
  line: Pick<KitchenLine, "done" | "voided">,
  state: TapState,
): { done: boolean } | null {
  if (line.voided || state.pending) return null;
  if (state.lastChangeAt !== null && state.now - state.lastChangeAt < KITCHEN_TAP_GUARD_MS) {
    return null;
  }
  return { done: !line.done };
}

/** The body of POST /api/kitchen/tickets/mark for a comanda, from its own fields. */
export function ticketMarkBody(ticket: KitchenTicket, closed: boolean): MarkTicketBody {
  return {
    sessionId: ticket.sessionId,
    firedAt: ticket.firedAt,
    course: ticket.course,
    segue: ticket.segue,
    closed,
  };
}

/** "2 di 5 fatti". */
export function doneCountLabel(
  done: number,
  total: number,
  locale: Locale = DEFAULT_LOCALE,
): string {
  return t("kitchen.doneCount", { done, total }, locale);
}

/** "Da fare: 7", or "Tutto fatto" at 0. */
export function remainingLabel(count: number, locale: Locale = DEFAULT_LOCALE): string {
  return count === 0
    ? t("kitchen.remaining.none", {}, locale)
    : t("kitchen.remaining", { count }, locale);
}

/** "Tutto fatto alle 20:41" (closed by itself) or "Chiusa alle 20:41 · Chef Demo" (by hand); empty when not closed. */
export function closedLabel(ticket: KitchenTicket, locale: Locale = DEFAULT_LOCALE): string {
  if (ticket.closedAt === null) return "";
  const time = formatTime(new Date(ticket.closedAt), locale);
  if (ticket.autoClosed) return t("kitchen.closedAt.auto", { time }, locale);
  return t("kitchen.closedAt.tap", { time, name: ticket.closedBy?.displayName ?? "" }, locale);
}

/**
 * The hint that explains why the kitchen buttons are disabled, or null when they work. Kitchen writes are online-only (M20 §1):
 * the screen counts as offline when the browser says so or when its own reads are stale.
 */
export function kitchenWriteBlock(
  state: { online: boolean; stale: boolean },
  locale: Locale = DEFAULT_LOCALE,
): string | null {
  return state.online && !state.stale ? null : t("kitchen.offline", {}, locale);
}

export interface Undo {
  /** "Tavolo 1 (demo) · Primi: comanda chiusa". */
  text: string;
  path: string;
  body: { done: false } | MarkTicketBody;
}

/**
 * What "Annulla" sends after a write that closed a comanda: undo the last line after an automatic close (`lineId` is the tapped line), or
 * reopen the comanda after "Chiudi comanda" (`lineId` is null). Null when the write closed nothing.
 */
export function undoFor(
  reply: { changed: boolean; autoClosed?: boolean },
  lineId: string | null,
  ticket: KitchenTicket,
  locale: Locale = DEFAULT_LOCALE,
): Undo | null {
  const text = t(
    "kitchen.undo.notice",
    { table: ticket.tableName, course: courseLabel(ticket.course, locale) },
    locale,
  );
  if (lineId !== null) {
    return reply.autoClosed
      ? { text, path: `/api/kitchen/lines/${lineId}/mark`, body: { done: false } }
      : null;
  }
  return reply.changed
    ? { text, path: "/api/kitchen/tickets/mark", body: ticketMarkBody(ticket, false) }
    : null;
}

/** "Segna fatto: 2 × Spezzatino…" for an open dish, "Annulla fatto: …" for a done one: what a tap does. */
export function lineAccessibleName(line: KitchenLine, locale: Locale = DEFAULT_LOCALE): string {
  const view = firedLine(line, locale);
  return t(line.done ? "kitchen.unmark.aria" : "kitchen.mark.aria", { line: view.text }, locale);
}
