import { t } from "@/lib/i18n";
import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n/locale";
import {
  COURSES,
  MAX_FIRE_LINES,
  VOID_REASONS,
  type Course,
  type VoidReason,
} from "@/server/orders/constants";
import type { OrderLine } from "@/server/orders/output";
import { SKIP_REASONS } from "@/server/orders/output";
import { courseLabel } from "./order-view";

// Presentation helpers for sending and voiding (M19 plan §3.6). Pure: they pick which line ids a button sends and word the
// buttons; they compute no stock and no price. The server decides what is fired; the ids sent are the ones shown.

export interface FireGroup {
  course: Course;
  /** Confirmed drafts that go with "Invia" (segue false). */
  normalIds: string[];
  /** Confirmed drafts that go with "Invia a seguire" (segue true). */
  segueIds: string[];
  /** A draft of this course is still being sent or failed: the buttons wait ("Attendi l'invio delle righe"). */
  blocked: boolean;
}

/**
 * The send buttons of the sheet, per course in service order, for the courses that have a draft. `unconfirmedIds` are the
 * lines still being sent or that failed to send: they block the course and are never part of the ids to send. Fired and
 * voided lines are not drafts.
 */
export function fireGroups(
  lines: readonly OrderLine[],
  unconfirmedIds: readonly string[] = [],
): FireGroup[] {
  const unconfirmed = new Set(unconfirmedIds);
  return COURSES.flatMap((course) => {
    const drafts = lines.filter((l) => l.course === course && l.state === "draft");
    if (drafts.length === 0) return [];
    const confirmed = drafts.filter((l) => !unconfirmed.has(l.id));
    return [
      {
        course,
        normalIds: confirmed.filter((l) => !l.segue).map((l) => l.id),
        segueIds: confirmed.filter((l) => l.segue).map((l) => l.id),
        blocked: drafts.some((l) => unconfirmed.has(l.id)),
      },
    ];
  });
}

const lower = (text: string) => text.toLocaleLowerCase();

/** "Invia primi · 2". */
export function sendLabel(course: Course, count: number, locale: Locale = DEFAULT_LOCALE): string {
  return t("orders.send.label", { course: lower(courseLabel(course, locale)), count }, locale);
}

/** "Invia a seguire · 1". */
export function sendSegueLabel(count: number, locale: Locale = DEFAULT_LOCALE): string {
  return t("orders.send.segueLabel", { count }, locale);
}

/** The accessible name of a send button: "Invia in cucina: Primi, 2 piatti". */
export function sendAriaLabel(
  course: Course,
  count: number,
  segue: boolean,
  locale: Locale = DEFAULT_LOCALE,
): string {
  return t(
    count === 1 ? "orders.send.aria.one" : "orders.send.aria.other",
    {
      course: segue
        ? t("orders.send.ariaSegue", { course: courseLabel(course, locale) }, locale)
        : courseLabel(course, locale),
      count,
    },
    locale,
  );
}

/** The ids split into consecutive calls of at most `size` (the server takes 1-50 per fire); order kept, none lost. */
export function chunkFireIds(ids: readonly string[], size: number = MAX_FIRE_LINES): string[][] {
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += size) chunks.push(ids.slice(i, i + size));
  return chunks;
}

/** What the server skipped, in words ("1 piatto era già in cucina"); null when nothing was. */
export function skippedMessage(
  skipped: readonly { lineId: string; reason: (typeof SKIP_REASONS)[number] }[],
  locale: Locale = DEFAULT_LOCALE,
): string | null {
  const parts = SKIP_REASONS.flatMap((reason) => {
    const count = skipped.filter((s) => s.reason === reason).length;
    if (count === 0) return [];
    return [t(`orders.skipped.${reason}.${count === 1 ? "one" : "other"}`, { count }, locale)];
  });
  return parts.length > 0 ? parts.join(". ") : null;
}

/** "Errore in cucina". */
export function voidReasonLabel(reason: VoidReason, locale: Locale = DEFAULT_LOCALE): string {
  return t(`orders.void.reason.${reason}`, {}, locale);
}

/** The six reasons of the void dialog, in the order of the database list; none is preselected. */
export function voidReasonOptions(
  locale: Locale = DEFAULT_LOCALE,
): { value: VoidReason; label: string }[] {
  return VOID_REASONS.map((value) => ({ value, label: voidReasonLabel(value, locale) }));
}
