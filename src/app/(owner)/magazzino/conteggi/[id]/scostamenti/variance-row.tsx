import { Card, LedgerRow } from "@/components/ui";
import { differenceText, formatCountEuro } from "@/lib/counts/count-view";
import { t } from "@/lib/i18n";
import { formatStockQty } from "@/lib/stock/stock-view";
import type { VarianceLine } from "@/server/counts/types";
import { DETAIL_LIST_CLASS } from "../../../../fatture/detail";

/**
 * One counted line of the variance: the name in bold and "Atteso … · Contato … · Differenza …" in .num, all the
 * server's numbers. The value in EUR is shown only when the caller passes it (owner and admin); `null` says "valore
 * non disponibile" and is never written as 0,00 €. Without `valueEur` the markup has no euro sign at all.
 */
export function VarianceRow({ line, valueEur }: { line: VarianceLine; valueEur?: number | null }) {
  return (
    <LedgerRow className="flex flex-col gap-1.5 py-3">
      <span className="min-w-0 font-bold [overflow-wrap:anywhere]">{line.name}</span>
      <p className="num text-sm [overflow-wrap:anywhere]">
        {t("variance.line", {
          expected: formatStockQty(line.expectedQty, line.baseUnit),
          counted: formatStockQty(line.countedQty, line.baseUnit),
          difference: differenceText(line.differenceQty, line.baseUnit),
        })}
      </p>
      {valueEur !== undefined && (
        <p className="num text-sm text-ink-muted">
          {valueEur === null ? t("variance.valueNa") : formatCountEuro(valueEur)}
        </p>
      )}
    </LedgerRow>
  );
}

/**
 * The totals of a count in EUR (owner and admin) as one fact sheet, with the number of lines that have no price, and
 * the number of lines left uncounted. All figures are the server's.
 */
export function VarianceTotals({
  totals,
  skipped,
}: {
  totals: { valueEur: number; lossEur: number; gainEur: number; unvaluedCount: number };
  skipped: number;
}) {
  return (
    <Card className="py-1">
      <dl className={DETAIL_LIST_CLASS}>
        <dt className="pr-4 text-ink-muted">{t("variance.totals.loss")}</dt>
        <dd className="num">{formatCountEuro(totals.lossEur)}</dd>
        <dt className="pr-4 text-ink-muted">{t("variance.totals.gain")}</dt>
        <dd className="num">{formatCountEuro(totals.gainEur)}</dd>
        <dt className="pr-4 text-ink-muted">{t("variance.totals.net")}</dt>
        <dd className="num font-bold">{formatCountEuro(totals.valueEur)}</dd>
        {totals.unvaluedCount > 0 && (
          <>
            <dt className="pr-4 text-ink-muted">{t("variance.totals.unvalued")}</dt>
            <dd className="num">{totals.unvaluedCount}</dd>
          </>
        )}
      </dl>
      <p className="num pb-3 text-sm text-ink-muted">{t("variance.skipped", { count: skipped })}</p>
    </Card>
  );
}
