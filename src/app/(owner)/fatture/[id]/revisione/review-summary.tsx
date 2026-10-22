import { Card, warningNoteClass } from "@/components/ui";
import { fieldLabel } from "@/lib/invoices/review-view";
import { t } from "@/lib/i18n";
import { formatEuro } from "@/lib/money/format";
import { formatCalendarDate } from "@/lib/time/format";
import type { InvoiceReview } from "@/server/invoices/review-types";
import { Detail, DETAIL_LIST_CLASS } from "../../detail";

// On a laptop the facts run two pairs to a row, so the lines start higher up the page.
const HEADER_LIST_CLASS = `${DETAIL_LIST_CLASS} lg:grid-cols-[auto_1fr_auto_1fr] lg:[&>:nth-last-child(-n+4)]:border-b-0`;
import { ExtractionNotes } from "../../extraction-notes";
import { StatusBadge } from "../../status-badge";

const euro = (amount: number | null) => (amount === null ? null : formatEuro(amount));

/** The header facts of the invoice and the notes the reading raised. Display only. */
export function ReviewHeader({ review }: { review: InvoiceReview }) {
  const { invoice } = review;
  return (
    <>
      <Card className="py-1">
        <dl className={HEADER_LIST_CLASS}>
          <dt className="pr-4 text-ink-muted">{t("invoices.status")}</dt>
          <dd className="flex">
            <StatusBadge status={invoice.status} />
          </dd>
          <Detail
            label={t("invoices.supplier")}
            value={review.supplier?.name ?? invoice.supplierName}
            testId="supplier"
          />
          <Detail
            label={t("suppliers.vatNumber")}
            value={invoice.supplierVat}
            testId="supplier-vat"
            numeric
          />
          <Detail label={t("invoices.number")} value={invoice.number} testId="number" />
          <Detail
            label={t("invoices.invoiceDate")}
            value={invoice.invoiceDate && formatCalendarDate(invoice.invoiceDate)}
            testId="invoice-date"
            numeric
          />
          <Detail
            label={t("invoices.dueDate")}
            value={invoice.dueDate && formatCalendarDate(invoice.dueDate)}
            testId="due-date"
            numeric
          />
          <Detail
            label={t("invoices.netTotal")}
            value={euro(invoice.netTotal)}
            testId="net-total"
            numeric
          />
          <Detail
            label={t("invoices.vatTotal")}
            value={euro(invoice.vatTotal)}
            testId="vat-total"
            numeric
          />
          <Detail
            label={t("invoices.grossTotal")}
            value={euro(invoice.grossTotal)}
            testId="gross-total"
            numeric
          />
        </dl>
      </Card>
      <ExtractionNotes invoice={invoice} />
      {invoice.lowConfidenceHeaderFields.length > 0 && (
        <p data-testid="header-uncertain" className={`${warningNoteClass} text-sm`}>
          {t("review.badge.uncertain", {
            fields: invoice.lowConfidenceHeaderFields.map(fieldLabel).join(", "),
          })}
        </p>
      )}
      {!review.editable && (
        <p data-testid="read-only" className={`${warningNoteClass} text-sm`}>
          {t("review.readOnly")}
        </p>
      )}
    </>
  );
}
