"use client";

import Link from "next/link";
import { use, useCallback, useEffect, useState } from "react";
import { Button, Card, ErrorAlert, Heading, linkClass, Muted } from "@/components/ui";
import { apiJson } from "@/lib/api/client";
import { formatBytes } from "@/lib/format/bytes";
import { t } from "@/lib/i18n";
import { formatDateTime } from "@/lib/time/format";
import type { InvoiceFileUrl, InvoiceItem } from "@/server/invoices/invoices";
import { StatusBadge } from "../status-badge";

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
        <dl className="grid grid-cols-[auto_1fr] items-center [&>*]:border-b [&>*]:border-rule [&>*]:py-3 [&>:nth-last-child(-n+2)]:border-b-0">
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
        </dl>
      </Card>
      <ErrorAlert message={error} />
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
