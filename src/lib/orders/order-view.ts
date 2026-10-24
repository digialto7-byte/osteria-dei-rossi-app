import { t } from "@/lib/i18n";
import { DEFAULT_LOCALE, INTL_LOCALE, type Locale } from "@/lib/i18n/locale";
import { formatTime } from "@/lib/time/format";
import type { ServiceMenu, ServiceMenuItem } from "@/server/menu/output";
import { COURSES, type Course } from "@/server/orders/constants";
import type { CONFLICT_REASONS, OrderLine } from "@/server/orders/output";

// Presentation helpers for the order screen. Pure: they only word what the API already decided (availability, the
// "few left" call, who changed a line and when) and filter by a field. Nothing here computes stock, a price or a total.

type ConflictReason = (typeof CONFLICT_REASONS)[number];

const numbers = new Map<Locale, Intl.NumberFormat>();

/** A quantity or portions-left number as the venue writes it: "2", "1,5", "0,5". */
export function formatQty(value: number, locale: Locale = DEFAULT_LOCALE): string {
  let formatter = numbers.get(locale);
  if (!formatter) {
    formatter = new Intl.NumberFormat(INTL_LOCALE[locale], { maximumFractionDigits: 1 });
    numbers.set(locale, formatter);
  }
  return formatter.format(value);
}

export function courseLabel(course: Course, locale: Locale = DEFAULT_LOCALE): string {
  return t(`orders.course.${course}`, {}, locale);
}

/** "Primi · 2"; just "Primi" for a course with no line yet. */
export function tabLabel(course: Course, count: number, locale: Locale = DEFAULT_LOCALE): string {
  const name = courseLabel(course, locale);
  return count > 0 ? t("orders.tab", { course: name, count }, locale) : name;
}

/** The lines that count on the sheet: everything the view returns except a fired line that was then voided. */
const live = (line: OrderLine) => line.state !== "voided";

/** Lines per course (voided lines excluded), with a zero for every course. */
export function courseCounts(lines: readonly OrderLine[]): Record<Course, number> {
  const counts = Object.fromEntries(COURSES.map((course) => [course, 0])) as Record<Course, number>;
  for (const line of lines) if (live(line)) counts[line.course] += 1;
  return counts;
}

/** The sheet's lines grouped by course in service order; empty courses and voided lines are left out. */
export function groupLinesByCourse(
  lines: readonly OrderLine[],
): { course: Course; lines: OrderLine[] }[] {
  return COURSES.map((course) => ({
    course,
    lines: lines.filter((line) => live(line) && line.course === course),
  })).filter((group) => group.lines.length > 0);
}

/** "Comanda · 7 righe". */
export function sheetSummary(lines: readonly OrderLine[], locale: Locale = DEFAULT_LOCALE): string {
  const count = lines.filter(live).length;
  if (count === 0) return t("orders.sheet.empty", {}, locale);
  return t(
    count === 1 ? "orders.sheet.summary.one" : "orders.sheet.summary.other",
    { count },
    locale,
  );
}

/**
 * The menu for the selected tab: the items whose `course` is the tab's, grouped by category in the API's order, then
 * every other item (shown under "Altri piatti"). The filter is a field match; a category name never decides.
 */
export function itemsForCourse(
  menu: ServiceMenu,
  course: Course,
): { groups: { name: string; items: ServiceMenuItem[] }[]; others: ServiceMenuItem[] } {
  const groups: { name: string; items: ServiceMenuItem[] }[] = [];
  const others: ServiceMenuItem[] = [];
  for (const category of menu.categories) {
    const mine = category.items.filter((item) => item.course === course);
    if (mine.length > 0) groups.push({ name: category.name, items: mine });
    others.push(...category.items.filter((item) => item.course !== course));
  }
  return { groups, others };
}

/** "Ne restano 3", from the database's `lowStock` and `portionsLeft`; null when there is nothing to say. */
export function hintFor(
  item: Pick<ServiceMenuItem, "lowStock" | "portionsLeft">,
  locale: Locale = DEFAULT_LOCALE,
): string | null {
  if (!item.lowStock || item.portionsLeft === null) return null;
  return t(
    item.portionsLeft === 1 ? "orders.hint.one" : "orders.hint.other",
    { count: formatQty(item.portionsLeft, locale) },
    locale,
  );
}

/** "2 × Spezzatino con polenta (demo)"; a half portion reads "½ Zuppa del giorno (demo)". */
export function lineLabel(qty: number, name: string, locale: Locale = DEFAULT_LOCALE): string {
  return qty === 0.5
    ? t("orders.line.half", { name }, locale)
    : t("orders.line.qty", { qty: formatQty(qty, locale), name }, locale);
}

/** What to tell the waiter when the server answered `conflict`: who changed the line and when, or why it is locked. */
export function conflictMessage(
  reason: ConflictReason,
  line: Pick<OrderLine, "updatedAt" | "updatedBy">,
  locale: Locale = DEFAULT_LOCALE,
): string {
  switch (reason) {
    case "stale":
      return t(
        "orderError.conflict_stale",
        { name: line.updatedBy.displayName, time: formatTime(new Date(line.updatedAt), locale) },
        locale,
      );
    case "fired":
      return t("orderError.conflict_fired", {}, locale);
    case "voided":
      return t("orderError.conflict_voided", {}, locale);
    case "session_closed":
      return t("orderError.session_closed", {}, locale);
  }
}

/** "Spezzatino con polenta (demo) è esaurito." */
export function unavailableMessage(name: string, locale: Locale = DEFAULT_LOCALE): string {
  return t("orderError.item_unavailable_named", { name }, locale);
}

/** The price the menu quotes: the push price while the dish is pushed, else the menu price. A choice, not a sum. */
export function shownPrice(item: Pick<ServiceMenuItem, "price" | "pushed" | "pushPrice">): number {
  return item.pushed && item.pushPrice !== null ? item.pushPrice : item.price;
}

/**
 * The line the screen shows at once while its POST is in flight ("Invio…"): one portion, a draft, the price the menu
 * quoted. The server's reply replaces it. The editor fields are placeholders no one sees (the row is not editable
 * until the reply).
 */
export function pendingLine(
  item: Pick<ServiceMenuItem, "id" | "name" | "price" | "pushed" | "pushPrice">,
  course: Course,
  lineId: string,
  clientUpdatedAt: string,
): OrderLine {
  return {
    id: lineId,
    menuItemId: item.id,
    name: item.name,
    course,
    qty: 1,
    segue: false,
    note: null,
    isShared: false,
    unitPrice: shownPrice(item),
    state: "draft",
    clientUpdatedAt,
    updatedAt: clientUpdatedAt,
    updatedBy: { id: "", displayName: "" },
  };
}

/** The quantity in the editor: "2", "1,5", and "½" for a half portion. */
export function qtyText(qty: number, locale: Locale = DEFAULT_LOCALE): string {
  return qty === 0.5 ? "½" : formatQty(qty, locale);
}
