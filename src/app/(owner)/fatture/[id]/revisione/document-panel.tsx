"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, ErrorAlert, linkClass, Muted } from "@/components/ui";
import { useMediaQuery } from "@/components/use-media-query";
import { apiJson } from "@/lib/api/client";
import { t } from "@/lib/i18n";
import { downloadLabel } from "@/lib/invoices/xml-review-view";
import type { InvoiceFileUrl } from "@/server/invoices/invoices";
import type { InvoiceReview } from "@/server/invoices/review-types";
import { XmlNotes } from "./xml-notes";
import { XmlSummary } from "./xml-summary";

// Tailwind's `lg` breakpoint: where the review screen goes two-column.
const LAPTOP = "(min-width: 64rem)";

/**
 * The invoice document next to the lines. On a laptop it is framed in place (a PDF in an iframe,
 * a photo as an image). On a phone in-page PDF viewing is unreliable, so a button opens the
 * browser's own viewer in a new tab. The address is a short-lived signed link: kept in state
 * only, never stored or logged. No `sandbox` on the frame: the document comes from the Storage
 * origin, never from ours.
 */
export function DocumentPanel({
  invoiceId,
  mime,
  review,
}: {
  invoiceId: string;
  mime: string;
  /** Given for the review screen: an XML invoice then gets its data card instead of a frame (nothing renders the XML). */
  review?: InvoiceReview;
}) {
  if (review?.invoice.xml) return <XmlDocumentPanel invoiceId={invoiceId} review={review} />;
  return <FilePanel invoiceId={invoiceId} mime={mime} />;
}

/**
 * The XML invoice's side of the screen: the data card with a download link for the original, and the notes card. The link is a
 * short-lived signed address fetched once when the panel opens (an attachment, never shown inline); "Ricarica documento" asks again.
 */
function XmlDocumentPanel({ invoiceId, review }: { invoiceId: string; review: InvoiceReview }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchUrl = useCallback(async () => {
    setError(null);
    const result = await apiJson<InvoiceFileUrl>(`/api/invoices/${invoiceId}/file-url`);
    if (result.ok) setUrl(result.data.url);
    else setError(result.error.message);
  }, [invoiceId]);

  useEffect(() => {
    // Fetching the signed link when the panel opens is the effect's job here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchUrl();
  }, [fetchUrl]);

  const xml = review.invoice.xml!;
  const download = (
    <div className="flex flex-col items-start gap-2">
      <ErrorAlert message={error} />
      {url ? (
        <a
          href={url}
          download
          rel="noopener noreferrer"
          aria-label={downloadLabel(xml)}
          className={linkClass}
        >
          {t("review.xml.download")}
        </a>
      ) : (
        !error && <Muted>{t("common.loading")}</Muted>
      )}
      {(url || error) && (
        <Button variant="quiet" onClick={fetchUrl}>
          {t("review.reloadDocument")}
        </Button>
      )}
    </div>
  );
  return (
    <div className="flex flex-col gap-6 lg:sticky lg:top-4">
      <XmlSummary review={review} download={download} />
      <XmlNotes notes={xml.notes} />
    </div>
  );
}

function FilePanel({ invoiceId, mime }: { invoiceId: string; mime: string }) {
  const laptop = useMediaQuery(LAPTOP);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchUrl = useCallback(async () => {
    setError(null);
    const result = await apiJson<InvoiceFileUrl>(`/api/invoices/${invoiceId}/file-url`);
    if (result.ok) setUrl(result.data.url);
    else setError(result.error.message);
  }, [invoiceId]);

  useEffect(() => {
    // Fetching the signed link when the laptop layout shows is the effect's job here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (laptop) void fetchUrl();
  }, [laptop, fetchUrl]);

  if (!laptop) {
    return (
      <div className="flex flex-col items-start gap-3">
        <ErrorAlert message={error} />
        <Button variant="secondary" onClick={fetchUrl}>
          {t("invoices.openDocument")}
        </Button>
        {url && (
          <a href={url} target="_blank" rel="noopener noreferrer" className={linkClass}>
            {t("invoices.openLink")}
          </a>
        )}
      </div>
    );
  }

  const frame = "h-[calc(100dvh-9rem)] min-h-96 w-full rounded-card border border-rule bg-surface";
  return (
    <div className="sticky top-4 flex flex-col items-start gap-3">
      <ErrorAlert message={error} />
      {url === null ? (
        !error && <Muted>{t("review.documentLoading")}</Muted>
      ) : mime === "application/pdf" ? (
        <iframe
          title={t("review.documentTitle")}
          src={url}
          referrerPolicy="no-referrer"
          className={frame}
        />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- a signed Storage link, not a build-time asset
        <img
          alt={t("review.documentTitle")}
          src={url}
          referrerPolicy="no-referrer"
          className={`${frame} object-contain`}
        />
      )}
      <Button variant="secondary" onClick={fetchUrl}>
        {t("review.reloadDocument")}
      </Button>
    </div>
  );
}
