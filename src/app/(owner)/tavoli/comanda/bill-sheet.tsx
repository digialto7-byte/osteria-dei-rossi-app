"use client";

import Link from "next/link";
import { Badge, Button, primaryLinkClass, SuccessNote, warningNoteClass } from "@/components/ui";
import {
  copertoLabel,
  groupBillLines,
  lineLabel,
  receiptSummary,
  unsentWarning,
} from "@/lib/bill/bill-view";
import { t } from "@/lib/i18n";
import { formatEuro } from "@/lib/money/format";
import type { BillOutput } from "@/server/bill/output";

/**
 * The bill as the database computed it (M21 plan §3.6): the lines by course with their amounts, the coperto, and the VAT-inclusive total.
 * Every figure is passed through formatEuro and nothing else: no sum, no rounding, no split is done here. Dishes never sent to the
 * kitchen are marked, and the warning offers the way back to the order. It is not a fiscal document, and says so. A closed table shows
 * its receipt summary instead of the close button.
 */
export function BillSheet({
  bill,
  onBack,
  onClose,
  onSplit,
}: {
  bill: BillOutput;
  onBack: () => void;
  onClose: () => void;
  onSplit: () => void;
}) {
  const groups = groupBillLines(bill.lines);
  const unsent = bill.unsentLineIds.length;
  return (
    <section className="flex flex-col gap-4">
      {unsent > 0 && (
        <div className="flex flex-col gap-3">
          <p role="status" className={warningNoteClass}>
            {unsentWarning(unsent)}
          </p>
          <Button variant="secondary" onClick={onBack}>
            {t("bill.backToOrder")}
          </Button>
        </div>
      )}
      {groups.map((group) => (
        <div key={group.course} className="flex flex-col gap-2">
          <h3 className="text-sm font-bold tracking-wide text-ink-muted uppercase">
            {group.label}
          </h3>
          <ul className="flex flex-col divide-y divide-rule rounded-lg border border-rule bg-surface">
            {group.lines.map((line) => (
              <li
                key={line.id}
                data-line-id={line.id}
                className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
              >
                <span className="flex flex-wrap items-center gap-2">
                  <span>{lineLabel(line)}</span>
                  {line.state === "draft" && <Badge tone="warning">{t("bill.unsentBadge")}</Badge>}
                </span>
                <span className="font-bold tabular-nums">{formatEuro(line.amount)}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {bill.coperto && (
        <p className="flex items-center justify-between gap-2 px-3">
          <span>{copertoLabel(bill.coperto)}</span>
          <span className="font-bold tabular-nums">{formatEuro(bill.coperto.amount)}</span>
        </p>
      )}
      <p className="flex items-baseline justify-between gap-2 border-t-2 border-ink px-3 pt-3">
        <span className="font-bold">{t("bill.total")}</span>
        <strong className="font-display text-3xl tabular-nums">{formatEuro(bill.total)}</strong>
      </p>
      <p className="px-3 text-sm text-ink-muted">{t("bill.notFiscal")}</p>
      {bill.closed && bill.receipt ? (
        <div className="flex flex-col gap-3">
          <SuccessNote role="status">{receiptSummary(bill.receipt)}</SuccessNote>
          <Link href="/tavoli" className={primaryLinkClass}>
            {t("bill.backToTables")}
          </Link>
        </div>
      ) : (
        <div className="flex flex-wrap gap-3">
          <Button onClick={onClose}>{t("bill.close.open")}</Button>
          <Button variant="secondary" onClick={onSplit}>
            {t("bill.split.open")}
          </Button>
        </div>
      )}
    </section>
  );
}
