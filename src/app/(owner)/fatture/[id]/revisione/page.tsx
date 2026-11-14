"use client";

import { BackLink } from "@/components/back-link";
import { use, useCallback, useEffect, useMemo, useState } from "react";
import {
  ErrorAlert,
  Heading,
  LedgerList,
  Muted,
  SubHeading,
  SuccessNote,
  warningNoteClass,
} from "@/components/ui";
import { apiJson } from "@/lib/api/client";
import {
  applyActionResponse,
  decidedNoticeKey,
  type ActionResponse,
  type Decision,
} from "@/lib/invoices/action-result";
import { firstLotMissingLineId, summaryText } from "@/lib/invoices/review-view";
import { duplicateBanner } from "@/lib/invoices/xml-review-view";
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
import { DuplicateAction, DuplicateBanner, type BannerActions } from "./duplicate-action";
import { HeaderEditor } from "./header-editor";
import { LineEditor } from "./line-editor";
import { LineRow } from "./review-line";
import { ReviewHeader } from "./review-summary";
import { SupplierPanel } from "./supplier-panel";
import { XmlHeaderChips } from "./xml-summary";

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
  // What the screen says after "Usa il file XML al posto del PDF": the result, or that the situation changed under the owner.
  const [replaceNotice, setReplaceNotice] = useState<{
    text: string;
    tone: "done" | "changed";
  } | null>(null);
  const [openLine, setOpenLine] = useState<string | null>(null);
  // "Mostra la prima": which line's editor gets the cursor in its Lotto field, and a token raised on each press so a second press refocuses.
  const [lotFocus, setLotFocus] = useState<{ lineId: string; token: number } | null>(null);
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

  // "Usa il file XML al posto del PDF" (plan §3.7 use-xml): a lost race (409) reloads with a sentence; a failure is the Italian message.
  const bannerActions: BannerActions = useMemo(
    () => ({
      clear: (partnerId) => send("/not-duplicate", "POST", { partnerId }, STALE_STATUSES),
      reject: (reason) => send("/reject", "POST", reason ? { reason } : {}, STALE_STATUSES),
      replace: async (partnerId) => {
        const result = await apiJson<{ status: "review" | "duplicate" }>(
          `/api/invoices/${id}/use-xml`,
          { method: "POST", body: { replaces: partnerId } },
        );
        if (result.ok) {
          // Another look-alike may keep it a duplicate: then its banner shows instead, with no claim that it is the one to check.
          setReplaceNotice(
            result.data.status === "review"
              ? { text: t("review.xml.replaced"), tone: "done" }
              : null,
          );
          await load();
          return null;
        }
        if (result.status === 409) {
          setReplaceNotice({ text: t("review.xml.situationChanged"), tone: "changed" });
          await load();
          return null;
        }
        return result.error.message;
      },
    }),
    [id, load, send],
  );

  function showFirstMissingLot() {
    const lineId = review ? firstLotMissingLineId(review.lines) : null;
    if (!lineId) return;
    setOpenLine(lineId);
    setLotFocus((current) => ({ lineId, token: (current?.token ?? 0) + 1 }));
    document.getElementById(`line-${lineId}`)?.scrollIntoView({ block: "start" });
  }

  if (!review) {
    return (
      <>
        <BackLink href={`/fatture/${id}`}>{t("review.back")}</BackLink>
        <ErrorAlert message={error} />
        {!error && <Muted>{t("common.loading")}</Muted>}
      </>
    );
  }

  const { invoice } = review;
  const banner = duplicateBanner(review);
  // The hint under a first code shows once on the page, not on every line.
  const firstCodeLineId = review.lines.find((line) => (line.xml?.codes.length ?? 0) > 0)?.id;
  const title =
    review.supplier?.name ??
    invoice.supplierName ??
    invoice.originalFilename ??
    t("invoices.untitled");
  return (
    <div data-layout="wide" className="flex flex-col gap-6">
      <BackLink href={`/fatture/${id}`}>{t("review.back")}</BackLink>
      <div className="[overflow-wrap:anywhere]">
        <Heading>{title}</Heading>
      </div>
      {invoice.xml && <XmlHeaderChips xml={invoice.xml} />}
      {decided && <SuccessNote role="status">{t(decidedNoticeKey(decided))}</SuccessNote>}
      {replaceNotice &&
        (replaceNotice.tone === "done" ? (
          <SuccessNote role="status">{replaceNotice.text}</SuccessNote>
        ) : (
          <p role="status" className={`${warningNoteClass} text-sm`}>
            {replaceNotice.text}
          </p>
        ))}
      {banner && (
        <DuplicateBanner
          key={`${invoice.status}:${banner.partnerId}`}
          view={banner}
          actions={bannerActions}
        />
      )}
      <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
        <DocumentPanel invoiceId={invoice.id} mime={invoice.fileMime} review={review} />
        <div className="flex min-w-0 flex-col gap-6">
          <ReviewHeader review={review} />
          {review.editable && (
            <HeaderEditor
              key={JSON.stringify(review.invoice)}
              invoice={review.invoice}
              save={(patch) => send("", "PATCH", patch)}
            />
          )}
          {!banner && (
            <DuplicateAction
              key={`${review.invoice.status}:${review.duplicatePartner?.id ?? "none"}`}
              invoice={review.invoice}
              partner={review.duplicatePartner}
              clear={(partnerId) => send("/not-duplicate", "POST", { partnerId }, STALE_STATUSES)}
            />
          )}
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
            {invoice.xml && <p className="text-sm text-ink-muted">{t("review.xml.linesSource")}</p>}
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
                                onIngredientCreated={(created) =>
                                  setIngredients((current) =>
                                    [...current, created].sort((a, b) =>
                                      a.name.localeCompare(b.name, "it"),
                                    ),
                                  )
                                }
                                costCentres={costCentres}
                                actions={lineActions}
                                focusLotToken={lotFocus?.lineId === target.id ? lotFocus.token : 0}
                                onClose={() => setOpenLine(null)}
                              />
                            ) : undefined,
                        }
                      : {};
                  return (
                    <LineRow
                      key={line.id}
                      line={line}
                      codeHint={line.id === firstCodeLineId}
                      saveLine={review.editable ? lineActions.saveLine : undefined}
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
          <ApprovalPanel
            review={review}
            actions={approvalActions}
            onShowFirstMissingLot={showFirstMissingLot}
          />
        </div>
      </div>
    </div>
  );
}
