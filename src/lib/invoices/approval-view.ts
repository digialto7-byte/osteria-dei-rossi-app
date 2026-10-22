import type { LineBadge } from "@/lib/invoices/review-view";
import { isMessageKey, t, tn, type MessageKey } from "@/lib/i18n";
import type { Locale } from "@/lib/i18n/locale";
import { formatEuro } from "@/lib/money/format";
import { formatCalendarDate, formatDateTime } from "@/lib/time/format";
import { formatQty } from "@/lib/units";
import type {
  ApprovalBlocker,
  ApprovalInfo,
  PayableFigures,
  ReviewDecision,
  ReviewLine,
} from "@/server/invoices/review-types";

// Presentation rules of the approval panel, kept out of the components so they can be tested.
// Nothing here computes an amount, a date or a blocker: every figure is what the database sent
// (plan §3.8, "components only render server values"); this only writes it down.

/** Blockers whose sentence counts lines; the count is the number of line ids the server named. */
const COUNTED = new Set(["lines_unmapped", "line_base_qty_unavailable"]);

/** The sentence for one blocker. A code this screen does not know still reads as a sentence. */
export function blockerText(blocker: ApprovalBlocker, locale?: Locale): string {
  if (COUNTED.has(blocker.code)) {
    return tn(
      `approval.blocker.${blocker.code}` as "approval.blocker.lines_unmapped",
      blocker.lineIds.length,
      locale,
    );
  }
  const key = `approval.blocker.${blocker.code}`;
  return t(isMessageKey(key) ? (key as MessageKey) : "approval.blocker.unknown", {}, locale);
}

/**
 * The blockers to show for the location the owner has chosen. With several locations the server
 * previews without a choice, so it always lists `location_required`; picking one answers it. The
 * server checks the chosen location again when approving.
 */
export function visibleBlockers(approval: ApprovalInfo, locationId: string): ApprovalBlocker[] {
  return approval.blockers.filter((b) => !(b.code === "location_required" && locationId !== ""));
}

/** Whether the approve button is enabled: no blocker is left after the owner's location choice. */
export function canApproveNow(approval: ApprovalInfo, locationId: string): boolean {
  return visibleBlockers(approval, locationId).length === 0;
}

/** "Da pagare 1.234,50 € entro il 29/10/2026 · dai termini del fornitore"; null without an amount. */
export function payableText(payable: PayableFigures, locale?: Locale): string | null {
  if (payable.amount === null) return null;
  const amount = formatEuro(payable.amount, locale);
  const head = payable.dueDate
    ? t(
        "approval.payableDue",
        { amount, date: formatCalendarDate(payable.dueDate, locale) },
        locale,
      )
    : t("approval.payable", { amount }, locale);
  return payable.dueDateSource
    ? `${head} · ${t(`approval.source.${payable.dueDateSource}`, {}, locale)}`
    : head;
}

/** "Totale fattura 1.240,00 € meno resi 5,50 €"; null when nothing is credited. */
export function creditText(payable: PayableFigures, locale?: Locale): string | null {
  if (payable.grossAmount === null || !payable.creditedAmount) return null;
  return t(
    "approval.credit",
    {
      gross: formatEuro(payable.grossAmount, locale),
      credited: formatEuro(payable.creditedAmount, locale),
    },
    locale,
  );
}

/** "Carico del 29/09/2026 · 6 carichi", with "in Cella" when the location is already known. */
export function receiptsText(
  approval: Pick<ApprovalInfo, "receiptDate" | "receipts">,
  locationName?: string | null,
  locale?: Locale,
): string {
  const count = tn("approval.receipts", approval.receipts, locale);
  const receipts = locationName
    ? t("approval.receiptsIn", { receipts: count, location: locationName }, locale)
    : count;
  return approval.receiptDate
    ? `${t("approval.receiptDate", { date: formatCalendarDate(approval.receiptDate, locale) }, locale)} · ${receipts}`
    : receipts;
}

/** The sentence of the second tap: what is booked, and that it cannot be undone. */
export function confirmText(
  approval: Pick<ApprovalInfo, "receipts" | "payable">,
  locale?: Locale,
): string {
  return t(
    "approval.confirm",
    {
      receipts: tn("approval.receipts", approval.receipts, locale),
      amount: formatEuro(approval.payable.amount ?? 0, locale),
    },
    locale,
  );
}

/** "il 25/10/2026, 02:30 da Titolare Demo": venue time (Europe/Rome); the name only if known. */
export function decisionText(decision: ReviewDecision, locale?: Locale): string {
  const instant = new Date(decision.at);
  const valid = !Number.isNaN(instant.getTime());
  const when = valid ? formatDateTime(instant, locale) : null;
  if (when && decision.byName) {
    return t("approval.decisionBy", { when, name: decision.byName }, locale);
  }
  if (when) return t("approval.decisionAt", { when }, locale);
  return decision.byName ? t("approval.decisionByOnly", { name: decision.byName }, locale) : "";
}

/** "Da caricare: 12 kg" before approval, "Caricato: 12 kg" after; null for a line that posts nothing. */
export function receiveBadge(line: ReviewLine, locale?: Locale): LineBadge | null {
  if (line.received) {
    return {
      id: "received",
      tone: "success",
      text: t(
        "approval.badge.received",
        { qty: formatQty(line.received.qty, line.received.unit, locale) },
        locale,
      ),
    };
  }
  if (line.toReceive) {
    return {
      id: "to-receive",
      tone: "info",
      text: t(
        "approval.badge.toReceive",
        { qty: formatQty(line.toReceive.qty, line.toReceive.unit, locale) },
        locale,
      ),
    };
  }
  return null;
}
