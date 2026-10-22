import type { BadgeTone } from "@/components/ui";
import { isMessageKey, t, tn, type MessageKey } from "@/lib/i18n";
import { formatEuro } from "@/lib/money/format";
import { formatNumber, formatQty } from "@/lib/units";
import type { InvoiceReview, ReviewLine } from "@/server/invoices/review-types";

// Presentation rules of the review screen, kept out of the components so they can be tested:
// which words a line carries, and how its figures are written. Nothing here decides anything
// about the data; the server has already ordered, flagged and summed it (plan §3.3).

export interface LineBadge {
  id: string;
  tone: BadgeTone;
  text: string;
}

/** The Italian name of a field the server sent (`unit_price`, `number_raw`); unknown names stay visible. */
export function fieldLabel(name: string): string {
  const key = `review.field.${name}`;
  return isMessageKey(key) ? t(key as MessageKey) : name;
}

const quantity = (qty: number, unit: ReviewLine["unit"]) =>
  unit === null ? formatNumber(qty) : formatQty(qty, unit);

const vatText = (rate: number) => `${formatNumber(rate)}%`;

/** "2 kg × 12,75 € = 25,50 € · IVA 10%": quantity, price, amount and VAT on one `.num` line. */
export function lineMeta(line: ReviewLine): string {
  const qty = quantity(line.qty, line.unit);
  const amount = formatEuro(line.lineAmount);
  const figures =
    line.unitPrice === null
      ? `${qty} · ${amount}`
      : `${qty} × ${formatEuro(line.unitPrice)} = ${amount}`;
  return line.vatRate === null ? figures : `${figures} · IVA ${vatText(line.vatRate)}`;
}

/** Whether a stock line still needs an ingredient. A split parent never does: its parts do. */
const isUnmapped = (line: ReviewLine) => line.isStock && !line.isSplit && line.ingredient === null;

/**
 * The words a line carries, in the order they matter. Colour only reinforces them: every badge
 * has its text (ui-foundation §2, "colour that carries meaning always comes with a word").
 */
export function lineBadges(line: ReviewLine): LineBadge[] {
  const badges: LineBadge[] = [];
  if (isUnmapped(line)) {
    badges.push({ id: "unmapped", tone: "warning", text: t("review.badge.unmapped") });
  }
  if (!line.isStock) {
    badges.push({
      id: "non-stock",
      tone: "neutral",
      text: t("review.badge.nonStock", { centre: line.costCentre?.name ?? "" }),
    });
  }
  if (line.lowConfidenceFields.length > 0) {
    badges.push({
      id: "uncertain",
      tone: "warning",
      text: t("review.badge.uncertain", {
        fields: line.lowConfidenceFields.map(fieldLabel).join(", "),
      }),
    });
  }
  if (line.checks.includes("amount_mismatch")) {
    badges.push({
      id: "amount_mismatch",
      tone: "danger",
      text: t("review.badge.amountMismatch"),
    });
  }
  if (line.checks.includes("vat_rate_unexpected")) {
    badges.push({
      id: "vat_rate_unexpected",
      tone: "warning",
      text: t("review.badge.vatUnexpected"),
    });
  }
  if (line.creditQty > 0) {
    badges.push({
      id: "credit",
      tone: "info",
      text: t("review.badge.credit", { qty: quantity(line.creditQty, line.unit) }),
    });
  }
  if (line.corrected) {
    badges.push({ id: "corrected", tone: "info", text: t("review.badge.corrected") });
  }
  if (line.mappingSource === "auto") {
    badges.push({ id: "auto", tone: "neutral", text: t("review.badge.auto") });
  }
  if (line.isSplit) {
    badges.push({
      id: "split",
      tone: "neutral",
      text: tn("review.badge.split", line.children?.length ?? 0),
    });
  }
  return badges;
}

/** "3 righe da abbinare · 2 da controllare": what is left to do on this invoice. */
export function summaryText(summary: InvoiceReview["summary"]): string {
  if (summary.lines === 0) return t("review.summary.empty");
  const parts: string[] = [];
  if (summary.unmapped > 0) parts.push(tn("review.unmapped", summary.unmapped));
  if (summary.toCheck > 0) parts.push(t("review.toCheck", { count: summary.toCheck }));
  if (parts.length === 0 && summary.corrected === 0) return t("review.summary.none");
  if (summary.corrected > 0) parts.push(tn("review.corrected", summary.corrected));
  return parts.join(" · ");
}
