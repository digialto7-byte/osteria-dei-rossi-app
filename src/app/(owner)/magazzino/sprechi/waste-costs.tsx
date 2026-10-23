import { Card, LedgerList, LedgerRow, Muted } from "@/components/ui";
import { t } from "@/lib/i18n";
import { formatEuro } from "@/lib/money/format";
import { formatStockQty } from "@/lib/stock/stock-view";
import { reasonLabel } from "@/server/stock/reasons";
import type { WasteCosts } from "@/server/stock/types";
import { DETAIL_LIST_CLASS } from "../../fatture/detail";

/**
 * The waste in EUR (owner and admin only): one fact sheet and a list per reason. Every figure is the server's. A line
 * with no recorded purchase says "valore non disponibile": it is never shown as 0,00 €.
 */
export function WasteCostsView({ data }: { data: WasteCosts }) {
  return (
    <>
      <Card className="py-1">
        <dl className={DETAIL_LIST_CLASS}>
          <dt className="pr-4 text-ink-muted">{t("stock.costs.total")}</dt>
          <dd data-testid="fact-waste-total" className="num font-bold">
            {formatEuro(data.valueEur)}
          </dd>
          {data.unvaluedCount > 0 && (
            <>
              <dt className="pr-4 text-ink-muted">{t("stock.costs.unvalued")}</dt>
              <dd data-testid="fact-unvalued" className="num">
                {data.unvaluedCount}
              </dd>
            </>
          )}
        </dl>
        {data.unvaluedCount > 0 && (
          <p className="pb-3 text-sm text-ink-muted">{t("stock.costs.unvaluedHint")}</p>
        )}
      </Card>
      {data.reasons.length === 0 ? (
        <Muted>{t("stock.costs.empty")}</Muted>
      ) : (
        <LedgerList>
          {data.reasons.map((reason) => (
            <LedgerRow key={reason.reasonCode} className="flex flex-col gap-1.5 py-3">
              <p className="num font-bold">
                {reasonLabel(reason.reasonCode)} · {formatEuro(reason.valueEur)}
              </p>
              {reason.lines.map((line) => (
                <p key={line.ingredientId} className="num text-sm [overflow-wrap:anywhere]">
                  {line.ingredientName} {formatStockQty(line.qty, line.baseUnit)} ·{" "}
                  {line.valueEur === null ? t("stock.costs.valueNa") : formatEuro(line.valueEur)}
                </p>
              ))}
            </LedgerRow>
          ))}
        </LedgerList>
      )}
    </>
  );
}
