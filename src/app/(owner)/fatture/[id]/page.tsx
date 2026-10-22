"use client";

import Link from "next/link";
import { use, useCallback, useEffect, useState } from "react";
import { Button, ErrorAlert, Heading } from "@/components/ui";
import { apiJson } from "@/lib/api/client";
import { formatBytes } from "@/lib/format/bytes";
import { t } from "@/lib/i18n";
import { formatEuro } from "@/lib/money/format";
import { formatCalendarDate, formatDateTime } from "@/lib/time/format";
import type { InvoiceFileUrl, InvoiceItem } from "@/server/invoices/invoices";
import { ExtractionNotes } from "../extraction-notes";
import { StatusBadge } from "../status-badge";

const euro = (amount: number | null) => (amount === null ? null : formatEuro(amount));

/** One label and value row; a value the reading did not find is left out. */
function Detail({ label, value, testId }: { label: string; value: string | null; testId: string }) {
  if (value === null || value === "") return null;
  return (
    <>
      <dt className="font-medium">{label}</dt>
      <dd data-testid={testId} className="[overflow-wrap:anywhere]">
        {value}
      </dd>
    </>
  );
}

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

  if (!invoice) {
    return (
      <>
        <ErrorAlert message={error} />
        {!error && <p>{t("common.loading")}</p>}
        <Link href="/fatture" className="inline-flex min-h-tap items-center underline">
          {t("invoices.backToList")}
        </Link>
      </>
    );
  }

  return (
    <>
      <div className="[overflow-wrap:anywhere]">
        <Heading>{invoice.originalFilename ?? t("invoices.untitled")}</Heading>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
        <dt className="font-medium">{t("invoices.status")}</dt>
        <dd>
          <StatusBadge status={invoice.status} />
        </dd>
        <dt className="font-medium">{t("invoices.type")}</dt>
        <dd data-testid="file-mime">{invoice.fileMime}</dd>
        <dt className="font-medium">{t("invoices.size")}</dt>
        <dd>{formatBytes(invoice.fileSizeBytes)}</dd>
        <dt className="font-medium">{t("invoices.date")}</dt>
        <dd>{formatDateTime(new Date(invoice.createdAt))}</dd>
        <Detail label={t("invoices.supplier")} value={invoice.supplierName} testId="supplier" />
        <Detail label={t("invoices.number")} value={invoice.number} testId="number" />
        <Detail
          label={t("invoices.invoiceDate")}
          value={invoice.invoiceDate && formatCalendarDate(invoice.invoiceDate)}
          testId="invoice-date"
        />
        <Detail
          label={t("invoices.dueDate")}
          value={invoice.dueDate && formatCalendarDate(invoice.dueDate)}
          testId="due-date"
        />
        <Detail label={t("invoices.netTotal")} value={euro(invoice.netTotal)} testId="net-total" />
        <Detail label={t("invoices.vatTotal")} value={euro(invoice.vatTotal)} testId="vat-total" />
        <Detail
          label={t("invoices.grossTotal")}
          value={euro(invoice.grossTotal)}
          testId="gross-total"
        />
        <Detail
          label={t("invoices.extractedAt")}
          value={invoice.extractedAt && formatDateTime(new Date(invoice.extractedAt))}
          testId="extracted-at"
        />
        {invoice.attempts > 0 && (
          <Detail
            label={t("invoices.attempts")}
            value={String(invoice.attempts)}
            testId="attempts"
          />
        )}
      </dl>
      <ExtractionNotes invoice={invoice} />
      <ErrorAlert message={error} />
      <Button onClick={openDocument}>{t("invoices.openDocument")}</Button>
      {link && (
        <a
          href={link}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-tap items-center underline"
        >
          {t("invoices.openLink")}
        </a>
      )}
      <Link href="/fatture" className="inline-flex min-h-tap items-center underline">
        {t("invoices.backToList")}
      </Link>
    </>
  );
}
