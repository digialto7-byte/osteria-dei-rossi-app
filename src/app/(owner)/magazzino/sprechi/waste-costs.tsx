import { Card, LedgerList, LedgerRow, Muted } from "@/components/ui";
import { t } from "@/lib/i18n";
import { formatEuro } from "@/lib/money/format";
import { formatPortions } from "@/lib/batches/batch-view";
import { formatStockQty } from "@/lib/stock/stock-view";
import { reasonLabel } from "@/server/stock/reasons";
import type { WasteCostBatchLine, WasteCosts } from "@/server/stock/types";
import { DETAIL_LIST_CLASS } from "../../fatture/detail";

/**
 * What a batch line is worth: null is "non valorizzato" (never 0,00 €); an amount with unvalued operations beside it
 * says how many are not in it ("10,00 € (+1 non valorizzata)").
 */
function batchLineValue(line: WasteCostBatchLine): string {
  if (line.valueEur === null) return t("stock.costs.batchNa");
  const value = formatEuro(line.valueEur);
  return line.unvaluedCount > 0
    ? t(`stock.costs.batchPartial.${line.unvaluedCount === 1 ? "one" : "other"}`, {
        value,
        count: line.unvaluedCount,
      })
    : value;
}

/**
 * The waste in EUR (owner and admin only): one fact sheet and a list per reason. Every figure is the server's. Per
 * reason the warehouse (raw ingredients) and the preparations (batches) are shown apart, then their lines. A raw line
 * with no recorded purchase says "valore non disponibile" and a batch line with an incomplete cost "non valorizzato":
 * neither is ever shown as 0,00 €.
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
              <p className="num text-sm">
                {t("stock.costs.raw", { value: formatEuro(reason.rawValueEur) })}
              </p>
              <p className="num text-sm">
                {t("stock.costs.batch", { value: formatEuro(reason.batchValueEur) })}
              </p>
              {reason.lines.map((line) => (
                <p key={line.ingredientId} className="num text-sm [overflow-wrap:anywhere]">
                  {line.ingredientName} {formatStockQty(line.qty, line.baseUnit)} ·{" "}
                  {line.valueEur === null ? t("stock.costs.valueNa") : formatEuro(line.valueEur)}
                </p>
              ))}
              {reason.batchLines.map((line) => (
                <p
                  key={`${line.recipeKey}-${line.recipeName}`}
                  className="num text-sm [overflow-wrap:anywhere]"
                >
                  {t("stock.costs.batchLine", {
                    name: line.recipeName,
                    portions: formatPortions(line.portions),
                    value: batchLineValue(line),
                  })}
                </p>
              ))}
            </LedgerRow>
          ))}
        </LedgerList>
      )}
    </>
  );
}
