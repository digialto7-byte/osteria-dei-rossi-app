import Link from "next/link";
import { FactList, FactRow } from "@/components/fact-list";
import { Badge, Card, linkClass, SubHeading } from "@/components/ui";
import { fixedCostView } from "@/lib/costing/cost-view";
import { t } from "@/lib/i18n";
import type { FixedCostStatus } from "@/server/costing/types";

/**
 * The fixed-cost card, shown to the owner only (the API sends the status to no one else). Allocated
 * figures, or the reason nothing is allocated; food cost % and GP % never wait for it.
 */
export function FixedCostCard({ status }: { status: FixedCostStatus }) {
  const view = fixedCostView(status);
  return (
    <Card className="flex flex-col gap-3">
      <SubHeading>{t("costs.fixed.title")}</SubHeading>
      {view.kind === "allocated" ? (
        <FactList>
          <FactRow label={t("costs.fixed.month")} figure testId="fixed-month">
            {view.month}
          </FactRow>
          <FactRow label={t("costs.fixed.sold")} figure testId="fixed-sold">
            {view.sold}
          </FactRow>
          <FactRow label={t("costs.fixed.perPlate")} figure testId="fixed-per-plate">
            <strong>{view.perPlate}</strong>
          </FactRow>
        </FactList>
      ) : (
        <>
          <Badge tone="info">{t("costs.fixed.unallocatedBadge")}</Badge>
          {view.kind === "no_sales" ? (
            <>
              <FactList>
                <FactRow label={t("costs.fixed.month")} figure testId="fixed-month">
                  {view.month}
                </FactRow>
              </FactList>
              <p>{t("costs.fixed.noSales")}</p>
            </>
          ) : (
            <Link href="/costi/impostazioni" className={linkClass}>
              {t("costs.fixed.noFixed")}
            </Link>
          )}
        </>
      )}
    </Card>
  );
}
