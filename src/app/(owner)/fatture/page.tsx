"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ErrorAlert, Heading, LedgerList, LedgerRow, linkClass, Muted } from "@/components/ui";
import { MeProblem } from "@/components/me-problem";
import { usePollWhile } from "@/components/use-poll-while";
import { useMe } from "@/components/use-me";
import { apiJson } from "@/lib/api/client";
import { canReadInvoices } from "@/lib/invoices/invoice-access";
import { invoiceTitle, isInFlight } from "@/lib/invoices/invoice-view";
import { t } from "@/lib/i18n";
import { formatEuro } from "@/lib/money/format";
import { formatDateTime } from "@/lib/time/format";
import { INVOICE_REFRESH_MS } from "@/server/invoices/constants";
import type { InvoiceItem } from "@/server/invoices/invoices";
import { ExtractionNotes } from "./extraction-notes";
import { StatusBadge } from "./status-badge";
import { UploadForm } from "./upload-form";

/** The invoices are for owner and admin; the others get one notice, not a form the API would refuse. */
export default function InvoicesPage() {
  const { status, me, retry } = useMe();
  if (status === "loading") return <Heading>{t("invoices.title")}</Heading>;
  if (me === null) {
    return (
      <>
        <Heading>{t("invoices.title")}</Heading>
        <MeProblem status={status} retry={retry} />
      </>
    );
  }
  if (!canReadInvoices(me.user.role)) {
    return (
      <>
        <Heading>{t("invoices.title")}</Heading>
        <ErrorAlert message={t("invoices.forbidden")} />
      </>
    );
  }
  return <InvoicesList />;
}

function InvoicesList() {
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

  // Extraction runs in the background: while any row is still being read, look again every few seconds.
  usePollWhile(
    invoices?.some((invoice) => isInFlight(invoice.status)) ?? false,
    INVOICE_REFRESH_MS,
    reload,
  );

  return (
    <>
      <Heading>{t("invoices.title")}</Heading>
      <UploadForm onUploaded={reload} />
      <Link href="/fatture/qualita" className={`${linkClass} self-start`}>
        {t("quality.link")}
      </Link>
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
                    {invoiceTitle(invoice)}
                  </span>
                  {invoice.originalFilename &&
                    invoiceTitle(invoice) !== invoice.originalFilename && (
                      <span className="text-sm [overflow-wrap:anywhere] text-ink-muted">
                        {invoice.originalFilename}
                      </span>
                    )}
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
