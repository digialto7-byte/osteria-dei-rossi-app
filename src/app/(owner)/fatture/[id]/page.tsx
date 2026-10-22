"use client";

import Link from "next/link";
import { use, useCallback, useEffect, useState } from "react";
import { Button, Card, ErrorAlert, Heading, linkClass, Muted } from "@/components/ui";
import { apiJson } from "@/lib/api/client";
import { formatBytes } from "@/lib/format/bytes";
import { t } from "@/lib/i18n";
import { formatEuro } from "@/lib/money/format";
import { formatCalendarDate, formatDateTime } from "@/lib/time/format";
import type { InvoiceFileUrl, InvoiceItem } from "@/server/invoices/invoices";
import { Detail, DETAIL_LIST_CLASS } from "../detail";
import { ExtractionNotes } from "../extraction-notes";
import { StatusBadge } from "../status-badge";

// The statuses whose lines the owner can open: `review` to correct, `duplicate` to look at.
const REVIEWABLE: readonly string[] = ["review", "duplicate"];

const euro = (amount: number | null) => (amount === null ? null : formatEuro(amount));

export default function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [invoice, setInvoice] = useState<InvoiceItem | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await apiJson<{ invoice: InvoiceItem }>(`/api/invoices/${id}`);
    if (result.ok) setInvoice(result.data.invoice);
    else setError(result.error.message);
  }, [id]);

  useEffect(() => {
    // Loading the invoice when the page opens is the effect's job here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

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
    const result = await apiJson<{ invoice: InvoiceItem }>(`/api/invoices/${id}/retry`, {
      method: "POST",
      body: {},
    });
    if (result.ok) setInvoice(result.data.invoice);
    else setError(result.error.message);
  }

  if (!invoice) {
    return (
      <>
        <ErrorAlert message={error} />
        {!error && <Muted>{t("common.loading")}</Muted>}
        <BackLink />
      </>
    );
  }

  return (
    <>
      <div className="[overflow-wrap:anywhere]">
        <Heading>{invoice.originalFilename ?? t("invoices.untitled")}</Heading>
      </div>
      <Card className="py-1">
        <dl className={DETAIL_LIST_CLASS}>
          <dt className="pr-4 text-ink-muted">{t("invoices.status")}</dt>
          <dd className="flex">
            <StatusBadge status={invoice.status} />
          </dd>
          <dt className="pr-4 text-ink-muted">{t("invoices.type")}</dt>
          <dd data-testid="file-mime" className="[overflow-wrap:anywhere]">
            {invoice.fileMime}
          </dd>
          <dt className="pr-4 text-ink-muted">{t("invoices.size")}</dt>
          <dd className="num">{formatBytes(invoice.fileSizeBytes)}</dd>
          <dt className="pr-4 text-ink-muted">{t("invoices.date")}</dt>
          <dd className="num">{formatDateTime(new Date(invoice.createdAt))}</dd>
          <Detail label={t("invoices.supplier")} value={invoice.supplierName} testId="supplier" />
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
          <Detail
            label={t("invoices.extractedAt")}
            value={invoice.extractedAt && formatDateTime(new Date(invoice.extractedAt))}
            testId="extracted-at"
            numeric
          />
          {invoice.attempts > 0 && (
            <Detail
              label={t("invoices.attempts")}
              value={String(invoice.attempts)}
              testId="attempts"
              numeric
            />
          )}
        </dl>
      </Card>
      <ExtractionNotes invoice={invoice} />
      <ErrorAlert message={error} />
      {REVIEWABLE.includes(invoice.status) && (
        <Link
          href={`/fatture/${id}/revisione`}
          data-testid="start-review"
          className={`${linkClass} self-start`}
        >
          {t("review.start")}
        </Link>
      )}
      {invoice.status === "extraction_failed" && (
        <Button variant="secondary" onClick={retry}>
          {t("review.retry")}
        </Button>
      )}
      <Button onClick={openDocument}>{t("invoices.openDocument")}</Button>
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
      <BackLink />
    </>
  );
}

function BackLink() {
  return (
    <Link href="/fatture" className={`${linkClass} self-start`}>
      <span aria-hidden="true" className="inline-block">
        ‹
      </span>
      {t("invoices.backToList")}
    </Link>
  );
}
