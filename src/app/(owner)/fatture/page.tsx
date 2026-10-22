"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ErrorAlert, Heading, LedgerList, LedgerRow, Muted } from "@/components/ui";
import { apiJson } from "@/lib/api/client";
import { t } from "@/lib/i18n";
import { formatEuro } from "@/lib/money/format";
import { formatDateTime } from "@/lib/time/format";
import type { InvoiceItem } from "@/server/invoices/invoices";
import { ExtractionNotes } from "./extraction-notes";
import { StatusBadge } from "./status-badge";
import { UploadForm } from "./upload-form";

export default function InvoicesPage() {
  const [invoices, setInvoices] = useState<InvoiceItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const result = await apiJson<{ invoices: InvoiceItem[] }>("/api/invoices");
    if (result.ok) {
      setInvoices(result.data.invoices);
      setError(null);
    } else {
      setError(result.error.message);
    }
  }, []);

  useEffect(() => {
    // Loading the list when the page opens is the effect's job here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();
  }, [reload]);

  return (
    <>
      <Heading>{t("invoices.title")}</Heading>
      <UploadForm onUploaded={reload} />
      <ErrorAlert message={error} />
      {invoices === null ? (
        !error && <Muted>{t("common.loading")}</Muted>
      ) : invoices.length === 0 ? (
        <Muted>{t("invoices.empty")}</Muted>
      ) : (
        <LedgerList>
          {invoices.map((invoice) => (
            <LedgerRow key={invoice.id}>
              <Link
                href={`/fatture/${invoice.id}`}
                className="group -mx-2 flex min-h-tap items-center gap-3 rounded-md px-2 py-3 transition-colors hover:bg-sunk"
              >
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="font-bold [overflow-wrap:anywhere] group-hover:underline group-hover:underline-offset-4">
                    {invoice.originalFilename ?? t("invoices.untitled")}
                  </span>
                  <span className="num text-sm text-ink-muted">
                    {t("invoices.uploadedAt", {
                      date: formatDateTime(new Date(invoice.createdAt)),
                    })}
                  </span>
                  {invoice.supplierName && (
                    <span className="text-sm [overflow-wrap:anywhere]">
                      {invoice.supplierName}
                      {invoice.grossTotal !== null && (
                        <span className="num">{` · ${formatEuro(invoice.grossTotal)}`}</span>
                      )}
                    </span>
                  )}
                  <StatusBadge status={invoice.status} />
                </span>
                <span
                  aria-hidden="true"
                  className="text-ink-muted transition-transform group-hover:translate-x-0.5"
                >
                  ›
                </span>
              </Link>
              <ExtractionNotes invoice={invoice} />
            </LedgerRow>
          ))}
        </LedgerList>
      )}
    </>
  );
}
