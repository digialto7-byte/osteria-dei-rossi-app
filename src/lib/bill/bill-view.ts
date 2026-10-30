import { t, tn } from "@/lib/i18n";
import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n/locale";
import { formatEuro } from "@/lib/money/format";
import { courseLabel, formatQty } from "@/lib/orders/order-view";
import type { PaymentType, ReceiptType } from "@/server/bill/constants";
import type { BillLine, BillOutput, BillReceipt, SplitInvalidDetails } from "@/server/bill/output";
import { COURSES, type Course } from "@/server/orders/constants";

// Presentation helpers for the bill (M21 plan §3.6). Pure: they only word and order what the database already computed. Nothing here
// adds, splits or rounds money; amounts go through formatEuro and nothing else.

/** "½" for half a portion, otherwise the number as the venue writes it ("2", "1,5"). */
export function qtyLabel(qty: number, locale: Locale = DEFAULT_LOCALE): string {
  return qty === 0.5 ? "½" : formatQty(qty, locale);
}

/** "2 × Spezzatino con polenta (demo)". */
export function lineLabel(
  line: Pick<BillLine, "qty" | "name">,
  locale: Locale = DEFAULT_LOCALE,
): string {
  return `${qtyLabel(line.qty, locale)} × ${line.name}`;
}

/** "Quota 1": the index comes from the database (stable). */
export function partLabel(index: number, locale: Locale = DEFAULT_LOCALE): string {
  return t("bill.part", { n: index }, locale);
}

/** The warning above the bill when dishes were never sent to the kitchen. */
export function unsentWarning(count: number, locale: Locale = DEFAULT_LOCALE): string {
  return tn("bill.unsent", count, locale);
}

/** "Coperto · 3 × 2,00 €": covers and the per-person price, both as the database gave them. */
export function copertoLabel(
  coperto: NonNullable<BillOutput["coperto"]>,
  locale: Locale = DEFAULT_LOCALE,
): string {
  return t(
    "bill.coperto",
    { count: coperto.covers, amount: formatEuro(coperto.perPerson, locale) },
    locale,
  );
}

export const receiptTypeLabel = (type: ReceiptType, locale: Locale = DEFAULT_LOCALE) =>
  t(`bill.receipt.${type}`, {}, locale);
export const paymentTypeLabel = (type: PaymentType, locale: Locale = DEFAULT_LOCALE) =>
  t(`bill.payment.${type}`, {}, locale);

/** "Tavolo chiuso · Scontrino 0012-0034 · Carta" or "Tavolo chiuso · senza numero di scontrino". */
export function receiptSummary(receipt: BillReceipt, locale: Locale = DEFAULT_LOCALE): string {
  if (receipt.number === null) {
    return t(
      "bill.summary.withoutNumber",
      { type: t(`bill.receiptLower.${receipt.type}`, {}, locale) },
      locale,
    );
  }
  return t(
    "bill.summary.withNumber",
    {
      type: receiptTypeLabel(receipt.type, locale),
      number: receipt.number,
      payment: paymentTypeLabel(receipt.paymentType, locale),
    },
    locale,
  );
}

export interface BillCourseGroup {
  course: Course;
  label: string;
  lines: BillLine[];
}

/** The lines grouped by course in service order; courses with no line are left out. */
export function groupBillLines(
  lines: readonly BillLine[],
  locale: Locale = DEFAULT_LOCALE,
): BillCourseGroup[] {
  return COURSES.map((course) => ({
    course,
    label: courseLabel(course, locale),
    lines: lines.filter((line) => line.course === course),
  })).filter((group) => group.lines.length > 0);
}

/** The words for a refused split: the reason the database gave, or the general text when there is none. */
export function splitErrorText(
  reason: SplitInvalidDetails["reason"] | undefined,
  covers: number,
  locale: Locale = DEFAULT_LOCALE,
): string {
  if (reason === undefined) return t("billError.split_invalid", {}, locale);
  return t(`billError.split_${reason}`, { covers }, locale);
}

/** "Conto 1" / "Bill 1": the name of a bill of the items split (the index is the database's, 1-based). */
export const groupLabel = (index: number, locale: Locale = DEFAULT_LOCALE) =>
  t("bill.split.group", { n: index }, locale);
