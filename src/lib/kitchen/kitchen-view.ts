import { formatWeight } from "@/lib/format/weight";
import { t } from "@/lib/i18n";
import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n/locale";
import { formatTime } from "@/lib/time/format";
import { qtyText } from "@/lib/orders/order-view";
import { voidReasonLabel } from "@/lib/orders/fire-view";
import { KITCHEN_STALE_MS } from "@/server/kitchen/constants";
import type { KitchenLine, KitchenTicket } from "@/server/kitchen/output";
import type { VoidReason } from "@/server/orders/constants";

// Presentation helpers for the kitchen screen (M19 plan §3.6). Pure: they word what the API decided. No euro value exists
// in the data, so none can appear here.

/** The roles that read the kitchen list (the database enforces it with app.require_kitchen_reader). */
export function canReadKitchen(role: string | null | undefined): boolean {
  return role === "owner" || role === "admin" || role === "chef";
}

/**
 * True when the last successful read is older than 60 s. `now` and `lastOkAt` come from the same clock of the screen
 * (Date.now()), so a phone/server clock skew cannot trigger it. No read yet counts as stale.
 */
export function isStale(lastOkAt: number | null, now: number): boolean {
  return lastOkAt === null || now - lastOkAt > KITCHEN_STALE_MS;
}

/** "Aggiornato alle 20:31", in Europe/Rome. */
export function asOfLabel(iso: string, locale: Locale = DEFAULT_LOCALE): string {
  return t("kitchen.asOf", { time: formatTime(new Date(iso), locale) }, locale);
}

/** "Stornato · Errore in cucina": a voided line says why in text. */
export function voidLabel(reason: VoidReason, locale: Locale = DEFAULT_LOCALE): string {
  return t("kitchen.voided", { reason: voidReasonLabel(reason, locale) }, locale);
}

/** "Subito" for uscita 0 (drinks), "2ª uscita" for 1..9 (comanda per uscita, plan 2026-11-18 §3.9). */
export function uscitaLabel(uscita: number, locale: Locale = DEFAULT_LOCALE): string {
  return uscita === 0
    ? t("kitchen.uscita.now", {}, locale)
    : t("kitchen.uscita.n", { n: uscita }, locale);
}

// Comanda per uscita: a ticket has no course and no segue any more. Until the card is redesigned (B2, plan step 15) the heading keeps
// its two field names: `course` carries the uscita label and `segueBadge` the "Aggiunta" badge of a later ticket of the same uscita.
export interface TicketHeading {
  table: string;
  covers: string;
  /** The uscita label: "1ª uscita", or "Subito" for drinks. */
  course: string;
  /** "Aggiunta" when the ticket is an addition to an uscita already in the kitchen; null otherwise. */
  segueBadge: string | null;
  /** "20:31 · Cameriere Demo". */
  sent: string;
}

export function ticketHeading(
  ticket: KitchenTicket,
  locale: Locale = DEFAULT_LOCALE,
): TicketHeading {
  return {
    table: ticket.tableName,
    covers: t(
      ticket.covers === 1 ? "kitchen.covers.one" : "kitchen.covers.other",
      { count: ticket.covers },
      locale,
    ),
    course: uscitaLabel(ticket.uscita, locale),
    segueBadge: ticket.addition ? t("kitchen.addition", {}, locale) : null,
    sent: t(
      "kitchen.sent",
      { time: formatTime(new Date(ticket.firedAt), locale), name: ticket.firedBy.displayName },
      locale,
    ),
  };
}

export interface FiredLineView {
  text: string;
  note: string | null;
  shared: boolean;
  voided: boolean;
  voidText: string | null;
  /** Done in the kitchen (decided in SQL; a voided line is never done). */
  done: boolean;
}

/** "2 × Spezzatino con polenta (demo)", "½ × Zuppa del giorno (demo)"; a weighted dish reads "Fiorentina 1,2 kg" (P2-0b). */
export function firedLine(line: KitchenLine, locale: Locale = DEFAULT_LOCALE): FiredLineView {
  return {
    text:
      line.weightG === null
        ? t("kitchen.line", { qty: qtyText(line.qty, locale), name: line.name }, locale)
        : t(
            "kitchen.lineWeighted",
            { name: line.name, weight: formatWeight(line.weightG, locale) },
            locale,
          ),
    note: line.note,
    shared: line.isShared,
    voided: line.voided,
    voidText: line.voided && line.voidReason ? voidLabel(line.voidReason, locale) : null,
    done: line.done,
  };
}
