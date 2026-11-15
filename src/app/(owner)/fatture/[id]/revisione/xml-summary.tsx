"use client";

import { useState, type ReactNode } from "react";
import { FactDetail, FactList, FactRow } from "@/components/fact-list";
import { Badge, Card, SubHeading } from "@/components/ui";
import { useMediaQuery } from "@/components/use-media-query";
import { t } from "@/lib/i18n";
import {
  bodyPositionText,
  headerChipText,
  signedText,
  vatRowText,
} from "@/lib/invoices/xml-review-view";
import { formatEuro } from "@/lib/money/format";
import { formatCalendarDate } from "@/lib/time/format";
import type { InvoiceReview, ReviewInvoiceXml } from "@/server/invoices/review-types";

// Tailwind's `lg` breakpoint: where the review screen goes two-column and the card stays open.
const LAPTOP = "(min-width: 64rem)";

/** The chips under the title of an XML invoice: what the file is, which of its invoices this is, and that a p7m is not verified. */
export function XmlHeaderChips({ xml }: { xml: ReviewInvoiceXml }) {
  const position = bodyPositionText(xml);
  const signed = signedText(xml);
  return (
    <div className="flex flex-col items-start gap-1.5">
      <Badge tone="info" data-testid="xml-chip">
        {headerChipText(xml)}
      </Badge>
      {position && <p className="text-sm text-ink-muted">{position}</p>}
      {signed && <p className="text-sm text-ink-muted">{signed}</p>}
    </div>
  );
}

const date = (iso: string | null) =>
  iso === null ? t("review.xml.dueMissing") : formatCalendarDate(iso);

/**
 * "Dati dal file XML": what the file said, in place of the framed document. The due date is "Scadenza pagamento", never "Scadenza",
 * which on this screen means a product expiry. Every value is the review reply's. On a phone the title folds the card (open by default);
 * on a laptop it is always open.
 */
export function XmlSummary({ review, download }: { review: InvoiceReview; download: ReactNode }) {
  const laptop = useMediaQuery(LAPTOP);
  const [open, setOpen] = useState(true);
  const { invoice, vatSummary } = review;
  if (!invoice.xml) return null;
  const supplier = review.supplier?.name ?? invoice.supplierName;
  const title = t("review.xml.title");
  const expanded = laptop || open;
  return (
    <Card className="flex flex-col gap-3">
      {laptop ? (
        <SubHeading>{title}</SubHeading>
      ) : (
        <SubHeading>
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((current) => !current)}
            className="flex min-h-tap w-full items-center justify-between gap-2 text-left"
          >
            {title}
            <span aria-hidden="true">{open ? "▴" : "▾"}</span>
          </button>
        </SubHeading>
      )}
      {expanded && (
        <>
          <p className="[overflow-wrap:anywhere]">
            {supplier && <span className="font-bold">{supplier}</span>}
            {invoice.supplierVat && (
              <span className="num block text-sm text-ink-muted">
                {t("review.xml.vatId", { vat: invoice.supplierVat })}
              </span>
            )}
          </p>
          <FactList testId="xml-facts">
            <FactDetail label={t("invoices.number")} value={invoice.number} testId="xml-number" />
            <FactDetail
              label={t("review.xml.date")}
              value={invoice.invoiceDate && formatCalendarDate(invoice.invoiceDate)}
              testId="xml-date"
            />
            <FactDetail
              label={t("invoices.paymentDue")}
              value={date(invoice.dueDate)}
              testId="xml-due-date"
            />
          </FactList>
          {vatSummary.length > 0 && (
            <section className="flex flex-col gap-1.5">
              <h3 className="font-bold">{t("review.xml.vatSummary")}</h3>
              <ul className="flex flex-col gap-1">
                {vatSummary.map((row, index) => (
                  <li
                    key={index}
                    data-testid="xml-vat-row"
                    className="num [overflow-wrap:anywhere]"
                  >
                    {vatRowText(row)}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {invoice.grossTotal !== null && (
            <FactList>
              <FactRow label={t("review.xml.total")} testId="xml-total">
                <strong>{formatEuro(invoice.grossTotal)}</strong>
              </FactRow>
            </FactList>
          )}
          {download}
        </>
      )}
    </Card>
  );
}
