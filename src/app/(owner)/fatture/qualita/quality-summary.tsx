import { Card, LedgerList, LedgerRow, Muted, SubHeading } from "@/components/ui";
import { formatCount } from "@/lib/format/count";
import { formatPercent } from "@/lib/format/percent";
import { t } from "@/lib/i18n";
import { fieldLabel } from "@/lib/invoices/review-view";
import type { ExtractionQualityReport } from "@/server/reports/extraction-quality";
import { Detail, DETAIL_LIST_CLASS } from "../detail";

const count = (n: number) => formatCount(n);

/** The extraction-quality figures. Display only: every number and rate comes from the report. */
export function QualitySummary({ report }: { report: ExtractionQualityReport }) {
  if (report.lines === 0) return <Muted>{t("quality.empty")}</Muted>;
  const fields = Object.entries(report.byField).filter(([, n]) => n > 0);
  return (
    <>
      <Card className="py-1">
        <dl className={DETAIL_LIST_CLASS}>
          <Detail label={t("quality.lines")} value={count(report.lines)} testId="q-lines" numeric />
          <Detail
            label={t("quality.corrected")}
            value={count(report.correctedLines)}
            testId="q-corrected"
            numeric
          />
          <Detail
            label={t("quality.rate")}
            value={formatPercent(report.correctionRate)}
            testId="q-rate"
            numeric
          />
          <Detail
            label={t("quality.auto")}
            value={count(report.autoMappedLines)}
            testId="q-auto"
            numeric
          />
          <Detail
            label={t("quality.autoRate")}
            value={formatPercent(report.autoMappedCorrectionRate)}
            testId="q-auto-rate"
            numeric
          />
        </dl>
      </Card>
      <p className="text-sm text-ink-muted">{t("quality.autoHint")}</p>
      {fields.length > 0 && (
        <section className="flex flex-col gap-3">
          <SubHeading>{t("quality.byField")}</SubHeading>
          <LedgerList>
            {fields.map(([field, n]) => (
              <LedgerRow key={field} className="flex justify-between gap-4 py-3">
                <span>{fieldLabel(field)}</span>
                <span className="num font-bold">{count(n)}</span>
              </LedgerRow>
            ))}
          </LedgerList>
        </section>
      )}
      {report.bySupplier.length > 0 && (
        <section className="flex flex-col gap-3">
          <SubHeading>{t("quality.bySupplier")}</SubHeading>
          <LedgerList>
            {report.bySupplier.map((supplier) => (
              <LedgerRow key={supplier.supplierId} className="flex flex-col gap-1 py-3">
                <span className="font-bold [overflow-wrap:anywhere]">{supplier.name}</span>
                <span className="num text-sm text-ink-muted">
                  {t("quality.supplierRow", {
                    lines: supplier.lines,
                    corrected: supplier.correctedLines,
                    rate: formatPercent(supplier.correctionRate),
                  })}
                </span>
              </LedgerRow>
            ))}
          </LedgerList>
        </section>
      )}
    </>
  );
}
