import type { BadgeTone } from "@/components/ui";
import { currentVenueSettings } from "@/lib/venue/current";
import { isMessageKey, t, tn } from "@/lib/i18n";
import type { SessionHeader } from "@/lib/orders/session-header";
import { unsentCountOf } from "@/lib/tables/unsent-count";
import { DEFAULT_LOCALE, INTL_LOCALE, type Locale } from "@/lib/i18n/locale";
import { formatEuro } from "@/lib/money/format";
import { formatTime } from "@/lib/time/format";
import type { ShownTile, ShownTileSession } from "@/lib/sync/overlay-tables";
import { venueDate } from "@/lib/time/venue-date";
import { MAX_TABLE_COVERS } from "@/server/tables/constants";
import { TABLE_STATUS_VALUES, type SessionCoperto } from "@/server/tables/output";

// Presentation helpers for the table screens. Pure: they only word what the API already decided (the status is the
// server's derivation, the coperto total is the server's number, the instants are shown in Europe/Rome). The role
// lists mirror the routes. Nothing here computes a status, a total or a date.

export const TABLE_STATUSES = TABLE_STATUS_VALUES;

/** Owner, admin and waiter use the tables; the chef gets 403 in M17. Mirrors the API's role list. */
export const canUseTables = (role: string): boolean =>
  role === "owner" || role === "admin" || role === "waiter";

/** Only owner and admin name the tables and set the coperto. Mirrors the API's role list. */
export const canConfigureTables = (role: string): boolean => role === "owner" || role === "admin";

/** "Libero", "Aperto", ...; an unknown status gets a neutral word, never the raw code. */
export function statusWord(status: string, locale: Locale = DEFAULT_LOCALE): string {
  const key = `tables.status.${status}`;
  return t(isMessageKey(key) ? key : "tables.status.unknown", {}, locale);
}

const TONES: Record<string, BadgeTone> = {
  free: "neutral",
  open: "success",
  courses_sent: "info",
  bill_requested: "warning",
  closed: "neutral",
  joined: "neutral",
};

/** The tone reinforces the word; it never carries the meaning alone. */
export function statusTone(status: string): BadgeTone {
  return Object.hasOwn(TONES, status) ? TONES[status]! : "neutral";
}

/** "1 coperto", "4 coperti". */
export function coversLine(covers: number, locale: Locale = DEFAULT_LOCALE): string {
  return tn("tables.covers", covers, locale);
}

const dateFormatters = new Map<string, Intl.DateTimeFormat>();

// "25/10": day and month in venue time.
function dayMonth(instant: Date, locale: Locale): string {
  const zone = currentVenueSettings().timeZone;
  const key = `${locale}|${zone}`;
  let formatter = dateFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(INTL_LOCALE[locale], {
      timeZone: zone,
      day: "2-digit",
      month: "2-digit",
    });
    dateFormatters.set(key, formatter);
  }
  const parts = formatter.formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  return `${part("day")}/${part("month")}`;
}

/**
 * "Cameriere Demo · 20:15" for a table opened in today's business day; "Cameriere Demo · 25/10 01:30" when it was
 * not (the server's `openedToday`). The instant is shown in Europe/Rome.
 */
export function openedLine(
  waiter: string,
  openedAt: string,
  openedToday: boolean,
  locale: Locale = DEFAULT_LOCALE,
): string {
  return t("tables.opened", { waiter, when: openedWhen(openedAt, openedToday, locale) }, locale);
}

/** "20:15" for today's business day, "25/10 01:30" otherwise, in venue time. */
function openedWhen(openedAt: string, openedToday: boolean, locale: Locale): string {
  const instant = new Date(openedAt);
  const clock = formatTime(instant, locale);
  return openedToday ? clock : `${dayMonth(instant, locale)} ${clock}`;
}

/**
 * "Cameriere Demo · 20:15 · Apertura in coda" for a table opened on this phone and not yet applied by the server (designer, Q-D6). The
 * time is the phone's own tap (`queuedAt`). Whether it was "today" is the plain calendar day in Rome compared with `now`, because a phone
 * can stay offline past midnight; the server's business-day cut-off does not apply to a phone-side tap.
 */
export function queuedOpenedLine(
  waiter: string,
  queuedAt: string,
  now: Date,
  locale: Locale = DEFAULT_LOCALE,
): string {
  const sameDay = venueDate(new Date(queuedAt)) === venueDate(now);
  return `${openedLine(waiter, queuedAt, sameDay, locale)} · ${t("tables.openQueued", {}, locale)}`;
}

/**
 * The opener line of a tile or of the table panel, by where the session comes from: the server's own open time and day, or, for a table
 * opened on this phone and not yet applied, the tap time with "Apertura in coda". `now` is the caller's clock (the render's).
 */
export function sessionMetaLine(
  session: ShownTileSession,
  now: Date,
  locale: Locale = DEFAULT_LOCALE,
): string {
  return session.source === "queued"
    ? queuedOpenedLine(session.waiter.displayName, session.queuedAt, now, locale)
    : openedLine(session.waiter.displayName, session.openedAt, session.openedToday, locale);
}

/** "Coperto 6,00 €" from the server's total; null when the table has no coperto. */
export function copertoLine(
  coperto: SessionCoperto | null,
  locale: Locale = DEFAULT_LOCALE,
): string | null {
  return coperto
    ? t("tables.coperto", { amount: formatEuro(coperto.total, locale) }, locale)
    : null;
}

/** The covers after a tap on "−" or "+": the step added, kept within 1 to 99. */
export function nextCovers(current: number, step: number): number {
  return Math.min(MAX_TABLE_COVERS, Math.max(1, current + step));
}

/** "Da inviare · 2": the tile's count of dishes not yet sent (W2). */
export function unsentBadge(count: number, locale: Locale = DEFAULT_LOCALE): string {
  return t("tables.tile.unsent", { count }, locale);
}

/** "2 piatti da inviare": the same count in words, for the tile's accessible name. */
export function unsentDishes(count: number, locale: Locale = DEFAULT_LOCALE): string {
  return tn("tables.unsentDishes", count, locale);
}

/**
 * The accessible name of a tile (docs/ux/p3-sala-waiter.md §2): the name, the status word and, for a table with a session, the covers, the
 * opener with the time ("Giulia alle 20:14", the date too for an earlier day), "Apertura in coda" for a table opened on this phone, and the
 * dishes to send when there are some. A count the reply did not carry is unknown and adds nothing. Joined tables have no label (they are not
 * a control). `now` is the caller's clock, as for `sessionMetaLine`.
 */
export function tileLabel(table: ShownTile, now: Date, locale: Locale = DEFAULT_LOCALE): string {
  const parts = [table.name, statusWord(table.status, locale)];
  const { session } = table;
  if (session !== null) {
    parts.push(coversLine(session.covers, locale));
    const waiter = session.waiter.displayName;
    if (session.source === "queued") {
      const sameDay = venueDate(new Date(session.queuedAt)) === venueDate(now);
      const when = openedWhen(session.queuedAt, sameDay, locale);
      parts.push(
        t("tables.tile.openedAria", { waiter, when }, locale),
        t("tables.openQueued", {}, locale),
      );
    } else {
      const when = openedWhen(session.openedAt, session.openedToday, locale);
      parts.push(t("tables.tile.openedAria", { waiter, when }, locale));
    }
    const unsent = unsentCountOf(session);
    if (unsent !== null && unsent > 0) parts.push(unsentDishes(unsent, locale));
  }
  return parts.join(", ");
}

/**
 * The comanda header's meta line (docs/ux/p3-sala-waiter.md §10.2, Q-D6): the covers, the opener with the time and the coperto, joined with
 * " · " and worded as on the tile. "4 coperti · Giulia · 20:14 · Coperto 10,00 €"; for a table opened on this phone and not yet applied,
 * "4 coperti · Giulia · 20:14 · Apertura in coda" (the phone's time, no coperto). A part the header reader does not know is left out: no
 * placeholder, so a reply cached before the fields were added reads "4 coperti". A queued session whose tap time is unknown reads
 * "4 coperti · Giulia · Apertura in coda" (no time), never the server line. `now` is the caller's clock.
 */
export function headerMetaLine(
  covers: number,
  header: SessionHeader,
  now: Date,
  locale: Locale = DEFAULT_LOCALE,
): string {
  const parts = [coversLine(covers, locale)];
  if (header.queued) {
    // A queued session never reads as a server one: with an unknown tap time it says "Apertura in coda" with no time (Rule B).
    if (header.openedBy !== null && header.queuedAt !== null) {
      parts.push(queuedOpenedLine(header.openedBy, header.queuedAt, now, locale));
    } else {
      if (header.openedBy !== null) parts.push(header.openedBy);
      parts.push(t("tables.openQueued", {}, locale));
    }
  } else {
    if (header.openedBy !== null && header.openedAt !== null && header.openedToday !== null) {
      parts.push(openedLine(header.openedBy, header.openedAt, header.openedToday, locale));
    }
    if (header.coperto !== null && header.coperto !== "unknown") {
      parts.push(copertoLine(header.coperto, locale)!);
    }
  }
  return parts.join(" · ");
}
