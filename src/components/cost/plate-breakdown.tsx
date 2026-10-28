import { Badge, Card, LedgerList, LedgerRow, SubHeading } from "@/components/ui";
import { formatPct, incompleteNotes, marginStatusView, reasonText } from "@/lib/costing/cost-view";
import { t } from "@/lib/i18n";
import { formatEuro } from "@/lib/money/format";
import type { ChefPlateBreakdown, OwnerPlateBreakdown } from "@/server/costing/plate-breakdown";

type Props =
  | { breakdown: OwnerPlateBreakdown; showMoney: true }
  | { breakdown: ChefPlateBreakdown; showMoney?: false };

const BAR_MAX = 100;

/** The bar is decoration: the share is also written as text beside it, so a screen reader gets the numbers. */
function ShareBar({ pct }: { pct: number }) {
  const width = Math.min(BAR_MAX, Math.max(0, pct));
  return (
    <div data-bar aria-hidden="true" className="h-2 w-full overflow-hidden rounded-full bg-sunk">
      <div className="h-full rounded-full bg-accent" style={{ width: `${width}%` }} />
    </div>
  );
}

/**
 * A plate's cost split by line, largest first (the order is the database's), each line with its share of the plate in
 * percent and a bar. With `showMoney` (the owner's and the admin's view) the line's cost and the plate's price, cost and
 * margin in euro are written too; without it nothing in euro is ever drawn, whatever the data holds (V6: the chef sees
 * percentages only). Pure display: every number was computed in Postgres.
 */
export function PlateBreakdownView(props: Props) {
  const { breakdown } = props;
  const money = props.showMoney === true ? (props.breakdown as OwnerPlateBreakdown).money : null;
  const status = marginStatusView(breakdown.status);
  const notes = incompleteNotes(breakdown);
  return (
    <section aria-label={t("breakdown.title")} className="flex flex-col gap-3">
      <SubHeading>{t("breakdown.title")}</SubHeading>
      <Card className="flex flex-col gap-1.5">
        <Badge tone={status.tone}>{status.label}</Badge>
        {breakdown.foodCostPct !== null && (
          <p className="num">
            {[
              t("costs.plate.foodPct", { value: formatPct(breakdown.foodCostPct) }),
              breakdown.gpPct !== null &&
                t("costs.plate.gp", { value: formatPct(breakdown.gpPct) }),
              breakdown.targetGpPct !== null &&
                t("costs.plate.target", { value: formatPct(breakdown.targetGpPct, 0) }),
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        )}
        {money && (
          <p className="num">
            {[
              money.foodCostEur !== null &&
                t("costs.plate.foodCost", { value: formatEuro(money.foodCostEur) }),
              money.salePriceExVatEur !== null &&
                t("costs.plate.exVat", { value: formatEuro(money.salePriceExVatEur) }),
              money.grossMarginEur !== null &&
                t("costs.plate.grossMargin", { value: formatEuro(money.grossMarginEur) }),
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        )}
        {notes.map((note) => (
          <p key={note} className="text-warning">
            {note}
          </p>
        ))}
      </Card>
      <LedgerList>
        {breakdown.lines.map((line) => {
          const cost = props.showMoney === true && "lineCostEur" in line ? line.lineCostEur : null;
          return (
            <LedgerRow key={line.position} className="flex flex-col gap-1.5 py-3">
              <span className="[overflow-wrap:anywhere]">{line.target.name}</span>
              {line.incomplete && (
                <Badge tone="warning">{reasonText(line.reason ?? "unknown")}</Badge>
              )}
              <p className="num text-sm text-ink-muted">
                {line.sharePct !== null
                  ? props.showMoney === true && cost !== null
                    ? t("breakdown.lineOwner", {
                        pct: formatPct(line.sharePct),
                        eur: formatEuro(cost),
                      })
                    : t("breakdown.lineChef", { pct: formatPct(line.sharePct) })
                  : line.incomplete
                    ? t("breakdown.unknown")
                    : cost !== null
                      ? t("breakdown.lineEurOnly", { eur: formatEuro(cost) })
                      : t("breakdown.noShare")}
              </p>
              {line.sharePct !== null && <ShareBar pct={line.sharePct} />}
            </LedgerRow>
          );
        })}
      </LedgerList>
    </section>
  );
}
