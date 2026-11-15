import type { LiHTMLAttributes } from "react";
import { CsvLink } from "@/components/csv-link";
import { FactList, FactRow } from "@/components/fact-list";
import { SubHeading } from "@/components/ui";
import { formatEur, formatPct } from "@/lib/dashboard/dashboard-view";
import { t } from "@/lib/i18n";
import type { ServicesReport } from "@/server/services/output";

const DASH = "—";

type Block = ServicesReport["total"];

const eur = (value: number | null) => (value === null ? DASH : formatEur(value));
const pct = (value: number | null) => (value === null ? DASH : formatPct(value));

function Figures({ block }: { block: Block }) {
  return (
    <FactList>
      <FactRow label={t("report.services.covers")}>
        <strong>{String(block.covers)}</strong>
      </FactRow>
      <FactRow label={t("report.services.net")}>
        <strong>{formatEur(block.revenueNetEur)}</strong>
      </FactRow>
      <FactRow label={t("report.services.share")}>
        <strong>{pct(block.revenueSharePct)}</strong>
      </FactRow>
      <FactRow label={t("report.services.spend")}>
        <strong>{eur(block.avgSpendPerCoverEur)}</strong>
      </FactRow>
      <FactRow label={t("report.services.foodCost")}>
        <strong>{pct(block.foodCostPct)}</strong>
      </FactRow>
    </FactList>
  );
}

function Row({ children, ...props }: LiHTMLAttributes<HTMLLIElement>) {
  return (
    <li {...props} className="flex flex-col gap-1 border-b border-rule py-3 last:border-b-0">
      {children}
    </li>
  );
}

/**
 * The period split by service (M25c plan §3.5), under the KPIs of Andamento: per service the covers, net revenue, share of the period, spend per
 * cover and food cost %, then a total row. Every figure comes from the database; this only prints them. The CSV is the table on screen.
 */
export function ServicesPanel({
  report,
  csvHref,
}: {
  report: ServicesReport;
  csvHref: string | null;
}) {
  return (
    <section role="group" aria-label={t("report.services.title")} className="flex flex-col gap-3">
      <SubHeading>{t("report.services.title")}</SubHeading>
      <ul className="flex flex-col border-y border-rule">
        {report.services.map((service) => (
          <Row key={service.key} data-service-key={service.key}>
            <span className="text-[1.125rem] font-bold">{service.name}</span>
            <Figures block={service} />
          </Row>
        ))}
        <Row data-services-total="">
          <span className="text-[1.125rem] font-bold">{t("report.services.total")}</span>
          <Figures block={report.total} />
        </Row>
      </ul>
      {csvHref !== null ? <CsvLink href={csvHref} label={t("report.services.csv")} /> : null}
    </section>
  );
}
