import Link from "next/link";
import { Badge, Card, linkClass, SubHeading } from "@/components/ui";
import { fixedCostView } from "@/lib/costing/cost-view";
import { t } from "@/lib/i18n";
import type { FixedCostStatus } from "@/server/costing/types";
import { Detail, DETAIL_LIST_CLASS } from "../fatture/detail";

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
        <dl className={DETAIL_LIST_CLASS}>
          <Detail label={t("costs.fixed.month")} value={view.month} testId="fixed-month" numeric />
          <Detail label={t("costs.fixed.sold")} value={view.sold} testId="fixed-sold" numeric />
          <Detail
            label={t("costs.fixed.perPlate")}
            value={view.perPlate}
            testId="fixed-per-plate"
            numeric
          />
        </dl>
      ) : (
        <>
          <Badge tone="info">{t("costs.fixed.unallocatedBadge")}</Badge>
          {view.kind === "no_sales" ? (
            <>
              <dl className={DETAIL_LIST_CLASS}>
                <Detail
                  label={t("costs.fixed.month")}
                  value={view.month}
                  testId="fixed-month"
                  numeric
                />
              </dl>
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
