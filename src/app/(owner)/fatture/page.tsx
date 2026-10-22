"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ErrorAlert, Heading } from "@/components/ui";
import { apiJson } from "@/lib/api/client";
import { t } from "@/lib/i18n";
import { formatDateTime } from "@/lib/time/format";
import type { InvoiceItem } from "@/server/invoices/invoices";
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
        !error && <p>{t("common.loading")}</p>
      ) : invoices.length === 0 ? (
        <p>{t("invoices.empty")}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-stone-200">
          {invoices.map((invoice) => (
            <li key={invoice.id}>
              <Link
                href={`/fatture/${invoice.id}`}
                className="flex min-h-tap flex-col justify-center gap-1 py-2"
              >
                <span className="font-medium [overflow-wrap:anywhere]">
                  {invoice.originalFilename ?? t("invoices.untitled")}
                </span>
                <span className="text-sm text-stone-600">
                  {t("invoices.uploadedAt", { date: formatDateTime(new Date(invoice.createdAt)) })}
                </span>
                <StatusBadge status={invoice.status} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
