"use client";

import Link from "next/link";
import { use, useCallback, useEffect, useState } from "react";
import { ErrorAlert, Heading, LedgerList, linkClass, Muted, SubHeading } from "@/components/ui";
import { apiJson } from "@/lib/api/client";
import { summaryText } from "@/lib/invoices/review-view";
import { t } from "@/lib/i18n";
import type { InvoiceReview } from "@/server/invoices/review-types";
import { DocumentPanel } from "./document-panel";
import { LineRow } from "./review-line";
import { ReviewHeader } from "./review-summary";

/**
 * The review screen: the document on the left and the lines on the right on a laptop, stacked on
 * a phone. It reads `/api/invoices/:id/review` and shows what the server sent; ordering,
 * highlights, base quantities and sums are the server's.
 */
export default function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [review, setReview] = useState<InvoiceReview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await apiJson<{ review: InvoiceReview }>(`/api/invoices/${id}/review`);
    if (result.ok) {
      setReview(result.data.review);
      setError(null);
    } else {
      setError(result.error.message);
    }
  }, [id]);

  useEffect(() => {
    // Loading the review when the page opens is the effect's job here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  if (!review) {
    return (
      <>
        <ErrorAlert message={error} />
        {!error && <Muted>{t("common.loading")}</Muted>}
        <BackLink id={id} />
      </>
    );
  }

  const { invoice } = review;
  const title =
    review.supplier?.name ??
    invoice.supplierName ??
    invoice.originalFilename ??
    t("invoices.untitled");
  return (
    <div data-layout="wide" className="flex flex-col gap-6">
      <div className="[overflow-wrap:anywhere]">
        <Heading>{title}</Heading>
      </div>
      <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
        <DocumentPanel invoiceId={invoice.id} mime={invoice.fileMime} />
        <div className="flex min-w-0 flex-col gap-6">
          <ReviewHeader review={review} />
          <ErrorAlert message={error} />
          <section className="flex flex-col gap-3">
            <SubHeading>{t("review.linesTitle")}</SubHeading>
            <p data-testid="review-summary" className="text-ink-muted">
              {summaryText(review.summary)}
            </p>
            {review.lines.length === 0 ? (
              <Muted>{t("review.noLines")}</Muted>
            ) : (
              <LedgerList>
                {review.lines.map((line) => (
                  <LineRow key={line.id} line={line} />
                ))}
              </LedgerList>
            )}
          </section>
          <BackLink id={id} />
        </div>
      </div>
    </div>
  );
}

function BackLink({ id }: { id: string }) {
  return (
    <Link href={`/fatture/${id}`} className={`${linkClass} self-start`}>
      <span aria-hidden="true" className="inline-block">
        ‹
      </span>
      {t("review.back")}
    </Link>
  );
}
