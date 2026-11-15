"use client";

import Link from "next/link";
import { BackLink } from "@/components/back-link";
import { FactList, FactRow } from "@/components/fact-list";
import { use, useCallback, useEffect, useState } from "react";
import { usePollWhile } from "@/components/use-poll-while";
import {
  Button,
  Card,
  ErrorAlert,
  Heading,
  linkClass,
  Muted,
  primaryLinkClass,
} from "@/components/ui";
import { apiJson } from "@/lib/api/client";
import { formatBytes } from "@/lib/format/bytes";
import { invoiceTitle, isInFlight, isReviewable } from "@/lib/invoices/invoice-view";
import { t } from "@/lib/i18n";
import { formatEuro } from "@/lib/money/format";
import { formatCalendarDate, formatDateTime } from "@/lib/time/format";
import { INVOICE_REFRESH_MS } from "@/server/invoices/constants";
import type { InvoiceFileUrl, InvoiceItem } from "@/server/invoices/invoices";
import { FactDetail } from "../detail";
import { ExtractionNotes } from "../extraction-notes";
import { StatusBadge } from "../status-badge";

const euro = (amount: number | null) => (amount === null ? null : formatEuro(amount));

export default function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [invoice, setInvoice] = useState<InvoiceItem | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);

  const load = useCallback(async () => {
    const result = await apiJson<{ invoice: InvoiceItem }>(`/api/invoices/${id}`);
    if (result.ok) {
      setInvoice(result.data.invoice);
      setError(null);
    } else setError(result.error.message);
  }, [id]);

  useEffect(() => {
    // Loading the invoice when the page opens is the effect's job here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  // Extraction runs in the background: while the invoice is still being read, look again every few seconds.
  usePollWhile(
    invoice !== null && isInFlight(invoice.status),
    INVOICE_REFRESH_MS,
    () => void load(),
  );

  // The signed URL is a short-lived bearer link: kept in state only, never stored or logged.
  async function openDocument() {
    setError(null);
    const result = await apiJson<InvoiceFileUrl>(`/api/invoices/${id}/file-url`);
    if (result.ok) setLink(result.data.url);
    else setError(result.error.message);
  }

  // "Riprova lettura": puts a failed invoice back in the queue (the worker makes the paid call).
  async function retry() {
    setError(null);
    setRetrying(true);
    const result = await apiJson<{ invoice: InvoiceItem }>(`/api/invoices/${id}/retry`, {
      method: "POST",
      body: {},
    });
    setRetrying(false);
    if (result.ok) setInvoice(result.data.invoice);
    else setError(result.error.message);
  }

  if (!invoice) {
    return (
      <>
        <BackLink href="/fatture">{t("invoices.backToList")}</BackLink>
        <ErrorAlert message={error} />
        {!error && <Muted>{t("common.loading")}</Muted>}
      </>
    );
  }

  const reviewable = isReviewable(invoice.status);
  return (
    <>
      <BackLink href="/fatture">{t("invoices.backToList")}</BackLink>
      <div className="[overflow-wrap:anywhere]">
        <Heading>{invoiceTitle(invoice)}</Heading>
        {invoice.originalFilename && invoiceTitle(invoice) !== invoice.originalFilename && (
          <p className="text-ink-muted">{invoice.originalFilename}</p>
        )}
      </div>
      <Card className="py-1">
        <FactList>
          <FactRow label={t("invoices.status")}>
            <StatusBadge status={invoice.status} />
          </FactRow>
          <FactRow label={t("invoices.date")}>
            {formatDateTime(new Date(invoice.createdAt))}
          </FactRow>
          <FactDetail
            label={t("invoices.supplier")}
            value={invoice.supplierName}
            testId="supplier"
          />
          <FactDetail label={t("invoices.number")} value={invoice.number} testId="number" />
          <FactDetail
            label={t("invoices.invoiceDate")}
            value={invoice.invoiceDate && formatCalendarDate(invoice.invoiceDate)}
            testId="invoice-date"
          />
          <FactDetail
            label={t("invoices.dueDate")}
            value={invoice.dueDate && formatCalendarDate(invoice.dueDate)}
            testId="due-date"
          />
          <FactDetail
            label={t("invoices.netTotal")}
            value={euro(invoice.netTotal)}
            testId="net-total"
          />
          <FactDetail
            label={t("invoices.vatTotal")}
            value={euro(invoice.vatTotal)}
            testId="vat-total"
          />
          <FactDetail
            label={t("invoices.grossTotal")}
            value={euro(invoice.grossTotal)}
            testId="gross-total"
          />
          <FactDetail
            label={t("invoices.extractedAt")}
            value={invoice.extractedAt && formatDateTime(new Date(invoice.extractedAt))}
            testId="extracted-at"
          />
          {invoice.attempts > 0 && (
            <FactDetail
              label={t("invoices.attempts")}
              value={String(invoice.attempts)}
              testId="attempts"
            />
          )}
        </FactList>
        {/* The file's technical facts: rarely needed, so they wait behind a tap. */}
        <details className="border-t border-rule">
          <summary className="flex min-h-tap cursor-pointer items-center font-bold text-accent-ink">
            {t("invoices.fileDetails")}
          </summary>
          <FactList>
            <FactRow label={t("invoices.type")} testId="file-mime">
              {invoice.fileMime}
            </FactRow>
            <FactRow label={t("invoices.size")}>{formatBytes(invoice.fileSizeBytes)}</FactRow>
          </FactList>
        </details>
      </Card>
      <ExtractionNotes invoice={invoice} />
      <ErrorAlert message={error} />
      {reviewable && (
        <Link
          href={`/fatture/${id}/revisione`}
          data-testid="start-review"
          className={`${primaryLinkClass} w-full`}
        >
          {t("review.start")}
        </Link>
      )}
      {invoice.status === "extraction_failed" && (
        <Button variant="secondary" onClick={retry} disabled={retrying}>
          {t("review.retry")}
        </Button>
      )}
      <Button variant={reviewable ? "secondary" : "primary"} onClick={openDocument}>
        {t("invoices.openDocument")}
      </Button>
      {link && (
        <a
          href={link}
          target="_blank"
          rel="noopener noreferrer"
          className={`${linkClass} self-start`}
        >
          {t("invoices.openLink")}
        </a>
      )}
    </>
  );
}
