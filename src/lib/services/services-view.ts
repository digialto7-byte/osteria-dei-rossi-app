import type { ServicePeriods } from "@/server/services/output";
import type { ServicesBody } from "@/server/services/schemas";
import { t } from "@/lib/i18n";

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
