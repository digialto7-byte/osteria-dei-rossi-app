"use client";

import Link from "next/link";
import { use, useCallback, useEffect, useMemo, useState } from "react";
import {
  ErrorAlert,
  Heading,
  LedgerList,
  linkClass,
  Muted,
  SubHeading,
  SuccessNote,
} from "@/components/ui";
import { apiJson } from "@/lib/api/client";
import {
  applyActionResponse,
  decidedNoticeKey,
  type ActionResponse,
  type Decision,
} from "@/lib/invoices/action-result";
import { summaryText } from "@/lib/invoices/review-view";
import { t } from "@/lib/i18n";
import type { InvoiceReview } from "@/server/invoices/review-types";
import type {
  ApprovalActions,
  CostCentreOption,
  IngredientOption,
  LineActions,
  SupplierActions,
  SupplierOption,
} from "./actions";
import { ApprovalPanel } from "./approval-panel";
import { DocumentPanel } from "./document-panel";
import { DuplicateAction } from "./duplicate-action";
import { HeaderEditor } from "./header-editor";
import { LineEditor } from "./line-editor";
import { LineRow } from "./review-line";
import { ReviewHeader } from "./review-summary";
import { SupplierPanel } from "./supplier-panel";

/** Statuses of a refused approval or rejection: the invoice is not what the screen showed. */
const STALE_STATUSES = [409, 422] as const;

/**
 * The review screen: the document on the left and the lines on the right on a laptop, stacked on
 * a phone. It reads `/api/invoices/:id/review` and shows what the server sent; ordering,
 * highlights, base quantities and sums are the server's.
 */
export default function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [review, setReview] = useState<InvoiceReview | null>(null);
  const [error, setError] = useState<string | null>(null);
  // A decision that committed while the review could not be reloaded: announced until it loads.
  const [decided, setDecided] = useState<Decision | null>(null);
  const [openLine, setOpenLine] = useState<string | null>(null);
  const [ingredients, setIngredients] = useState<IngredientOption[]>([]);
  const [costCentres, setCostCentres] = useState<CostCentreOption[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);

  const load = useCallback(async () => {
    const result = await apiJson<{ review: InvoiceReview }>(`/api/invoices/${id}/review`);
    if (result.ok) {
      setReview(result.data.review);
      setDecided(null);
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

  const editable = review?.editable === true;
  useEffect(() => {
    // The pickers (ingredients, cost centres, suppliers) are only needed while the invoice can
    // be edited; each is one plain list endpoint.
    if (!editable) return;
    void (async () => {
      const [i, c, s] = await Promise.all([
        apiJson<{ ingredients: IngredientOption[] }>("/api/ingredients?active=true"),
        apiJson<{ costCentres: CostCentreOption[] }>("/api/cost-centres?active=true"),
        apiJson<{ suppliers: SupplierOption[] }>("/api/suppliers?active=true"),
      ]);
      if (i.ok) setIngredients(i.data.ingredients);
      if (c.ok) setCostCentres(c.data.costCentres);
      if (s.ok) setSuppliers(s.data.suppliers);
    })();
  }, [editable]);

  /**
   * One write to the API. A success replaces the review with the fresh one the server sent (or loads it when the server could not); a
   * failure comes back as the Italian message, and a lost race (the invoice left review) reloads.
   */
  const send = useCallback(
    async (
      path: string,
      method: "POST" | "PATCH",
      body: unknown,
      reloadOn: readonly number[] = [],
    ): Promise<string | null> => {
      const result = await apiJson<ActionResponse>(`/api/invoices/${id}${path}`, {
        method,
        body,
      });
      if (result.ok) {
        // An approval or rejection that committed but could not reload its review answers 200 with
        // `review: null` and the status: the action is done, so show the decided state at once
        // (never the Approve button again) and fetch the review here instead of showing an error.
        const outcome = applyActionResponse(review, result.data);
        setReview(outcome.review);
        setDecided(outcome.decided);
        if (outcome.reload) void load();
        setError(null);
        return null;
      }
      if (result.error.code === "invoice_not_in_review" || reloadOn.includes(result.status)) {
        void load();
      }
      return result.error.message;
    },
    [id, load, review],
  );

  const lineActions: LineActions = useMemo(
    () => ({
      saveLine: (lineId, patch) => send(`/lines/${lineId}`, "PATCH", patch),
      createCentre: async (name) => {
        const result = await apiJson<{ costCentre: CostCentreOption }>("/api/cost-centres", {
          method: "POST",
          body: { name },
        });
        if (!result.ok) return { error: result.error.message };
        setCostCentres((current) => [...current, result.data.costCentre]);
        return { id: result.data.costCentre.id };
      },
      split: (lineId, children) => send(`/lines/${lineId}/split`, "POST", { children }),
      unsplit: (lineId) => send(`/lines/${lineId}/unsplit`, "POST", {}),
    }),
    [send],
  );
  const supplierActions: SupplierActions = useMemo(
    () => ({
      link: (supplierId) => send("/supplier", "POST", { supplierId }),
      create: (body) => send("/supplier", "POST", { create: body }),
    }),
    [send],
  );

  // A refused approval or rejection (409/422) means the invoice is not as the screen showed it, or
  // was decided in another tab: reload, so the panel shows the current blockers or the decision.
  const approvalActions: ApprovalActions = useMemo(
    () => ({
      approve: (locationId) =>
        send("/approve", "POST", locationId ? { locationId } : {}, STALE_STATUSES),
      reject: (reason) => send("/reject", "POST", reason ? { reason } : {}, STALE_STATUSES),
    }),
    [send],
  );

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
      {decided && <SuccessNote role="status">{t(decidedNoticeKey(decided))}</SuccessNote>}
      <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
        <DocumentPanel invoiceId={invoice.id} mime={invoice.fileMime} />
        <div className="flex min-w-0 flex-col gap-6">
          <ReviewHeader review={review} />
          {review.editable && (
            <HeaderEditor
              key={JSON.stringify(review.invoice)}
              invoice={review.invoice}
              save={(patch) => send("", "PATCH", patch)}
            />
          )}
          <DuplicateAction
            key={`${review.invoice.status}:${review.duplicatePartner?.id ?? "none"}`}
            invoice={review.invoice}
            partner={review.duplicatePartner}
            clear={(partnerId) => send("/not-duplicate", "POST", { partnerId }, STALE_STATUSES)}
          />
          <SupplierPanel
            key={review.supplier?.id ?? "none"}
            review={review}
            suppliers={suppliers}
            actions={supplierActions}
          />
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
                {review.lines.map((line) => {
                  const edit = (target: typeof line) =>
                    review.editable
                      ? {
                          onEdit: () => setOpenLine(openLine === target.id ? null : target.id),
                          expanded: openLine === target.id,
                          editor:
                            openLine === target.id ? (
                              <LineEditor
                                // Remounted when the server's copy of the line changes.
                                key={JSON.stringify(target)}
                                line={target}
                                child={target.parentLineId !== null}
                                ingredients={ingredients}
                                costCentres={costCentres}
                                actions={lineActions}
                                onClose={() => setOpenLine(null)}
                              />
                            ) : undefined,
                        }
                      : {};
                  return (
                    <LineRow
                      key={line.id}
                      line={line}
                      {...edit(line)}
                      renderChild={(child) => (
                        <LineRow key={child.id} line={child} {...edit(child)} />
                      )}
                    />
                  );
                })}
              </LedgerList>
            )}
          </section>
          <ApprovalPanel review={review} actions={approvalActions} />
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
