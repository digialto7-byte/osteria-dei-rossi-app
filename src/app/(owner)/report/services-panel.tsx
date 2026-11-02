import type { LiHTMLAttributes } from "react";
import { CsvLink } from "@/components/csv-link";
import { SubHeading } from "@/components/ui";
import { formatEur, formatPct } from "@/lib/dashboard/dashboard-view";
import { t } from "@/lib/i18n";
import type { ServicesReport } from "@/server/services/output";

const DASH = "—";

type Block = ServicesReport["total"];

const eur = (value: number | null) => (value === null ? DASH : formatEur(value));
const pct = (value: number | null) => (value === null ? DASH : formatPct(value));

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <dt className="text-ink-muted">{label}</dt>{" "}
      <dd className="font-bold tabular-nums">{value}</dd>
    </div>
  );
}

function Figures({ block }: { block: Block }) {
  return (
    <dl className="grid grid-cols-1 gap-y-1">
      <Figure label={t("report.services.covers")} value={String(block.covers)} />
      <Figure label={t("report.services.net")} value={formatEur(block.revenueNetEur)} />
      <Figure label={t("report.services.share")} value={pct(block.revenueSharePct)} />
      <Figure label={t("report.services.spend")} value={eur(block.avgSpendPerCoverEur)} />
      <Figure label={t("report.services.foodCost")} value={pct(block.foodCostPct)} />
    </dl>
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
