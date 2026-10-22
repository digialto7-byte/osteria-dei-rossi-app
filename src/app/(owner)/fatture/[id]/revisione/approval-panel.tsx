"use client";

import { useId, useState } from "react";
import {
  Badge,
  Button,
  Card,
  ErrorAlert,
  Field,
  linkClass,
  Select,
  SubHeading,
  SuccessNote,
  warningNoteClass,
} from "@/components/ui";
import {
  blockerText,
  canApproveNow,
  confirmText,
  creditText,
  decisionText,
  payableText,
  receiptsText,
  visibleBlockers,
} from "@/lib/invoices/approval-view";
import { t } from "@/lib/i18n";
import type { ApprovalInfo, InvoiceReview } from "@/server/invoices/review-types";
import type { ApprovalActions } from "./actions";
import { RejectForm } from "./reject-form";

type Step = "idle" | "confirm" | "reject";

/**
 * The second tap of an approval: what will be booked, in words, and that it cannot be undone.
 * Nothing is computed here: the sentence is the server's preview written out.
 */
export function ApproveConfirm({
  approval,
  locationName,
  busy,
  onConfirm,
  onCancel,
}: {
  approval: Pick<ApprovalInfo, "receipts" | "payable">;
  locationName: string | null;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      role="group"
      aria-label={t("approval.confirmApprove")}
      className="flex w-full flex-col gap-3 rounded-lg border border-rule p-3"
    >
      <p data-testid="approval-confirm" className="num font-bold [overflow-wrap:anywhere]">
        {confirmText(approval)}
      </p>
      {locationName && (
        <p className="text-sm [overflow-wrap:anywhere] text-ink-muted">
          {t("approval.postedLocation", { name: locationName })}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy} aria-busy={busy} onClick={onConfirm}>
          {t("approval.confirmApprove")}
        </Button>
        <Button variant="quiet" disabled={busy} onClick={onCancel}>
          {t("common.cancel")}
        </Button>
      </div>
    </div>
  );
}

/** The outcome, once decided: who and when (venue time), what was posted or why it was rejected. */
function DecisionCard({
  review,
  error,
}: {
  review: InvoiceReview & { decision: NonNullable<InvoiceReview["decision"]> };
  error: string | null;
}) {
  const { decision, posting } = review;
  const approved = decision.action === "approved";
  const payable = approved && posting ? payableText(posting.payable) : null;
  return (
    <Card data-testid="approval-panel" className="flex flex-col gap-3">
      <SubHeading>{t("approval.title")}</SubHeading>
      <ErrorAlert message={error} />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Badge tone={approved ? "success" : "danger"} data-testid="decision-badge">
          {t(`invoiceStatus.${decision.action}`)}
        </Badge>
        <p data-testid="decision-line" className="num">
          {decisionText(decision)}
        </p>
      </div>
      {payable && (
        <p data-testid="posted-payable" className="num font-bold [overflow-wrap:anywhere]">
          {payable}
        </p>
      )}
      {approved && posting?.locationName && (
        <p className="text-sm [overflow-wrap:anywhere] text-ink-muted">
          {t("approval.postedLocation", { name: posting.locationName })}
        </p>
      )}
      {approved && <SuccessNote role="status">{t("approval.done")}</SuccessNote>}
      {!approved && decision.reason && (
        <p data-testid="decision-reason" className="[overflow-wrap:anywhere]">
          {t("approval.rejectedReason", { reason: decision.reason })}
        </p>
      )}
    </Card>
  );
}

/**
 * Approval and rejection of the invoice. While it is in review: the payable, the receipts that
 * will be booked, the blockers in words with a link to their line, "Approva fattura" (disabled
 * while any blocker is left) and "Rifiuta". Approving takes two taps. Every figure is the
 * server's; the errors of a lost race stay visible after the page has reloaded the review.
 */
export function ApprovalPanel({
  review,
  actions,
}: {
  review: InvoiceReview;
  actions: ApprovalActions;
}) {
  const { approval, decision } = review;
  const [asked, setStep] = useState<Step>("idle");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [locationId, setLocationId] = useState(approval?.locations.defaultId ?? "");
  const blockersId = useId();

  async function run(action: () => Promise<string | null>) {
    setBusy(true);
    setError(null);
    const failure = await action();
    setBusy(false);
    if (failure) {
      setError(failure);
      setStep("idle");
    }
  }

  if (decision) return <DecisionCard review={{ ...review, decision }} error={error} />;

  const duplicate = review.invoice.status === "duplicate";
  if (!approval && !duplicate) return null;

  const blockers = approval ? visibleBlockers(approval, locationId) : [];
  // An edit made while the confirmation is open can bring a blocker back: then the second tap
  // gives way to the list again, so nothing is confirmed against a sentence that no longer holds.
  const step: Step = asked === "confirm" && blockers.length > 0 ? "idle" : asked;
  const chosen = approval?.locations.options.find((option) => option.id === locationId);
  return (
    <Card data-testid="approval-panel" className="flex flex-col gap-3">
      <SubHeading>{t("approval.title")}</SubHeading>
      <ErrorAlert message={error} />
      {approval && <Summary approval={approval} />}
      {approval && step === "idle" && approval.locations.required && (
        <Field label={t("approval.location")}>
          <Select
            value={locationId}
            onChange={(event) => setLocationId(event.target.value)}
            disabled={busy}
          >
            <option value="">{t("approval.locationChoose")}</option>
            {approval.locations.options.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </Select>
        </Field>
      )}
      {approval && step === "idle" && blockers.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="font-bold">{t("approval.blockersTitle")}</p>
          <ul id={blockersId} data-testid="approval-blockers" className="flex flex-col gap-2">
            {blockers.map((blocker) => (
              <li
                key={blocker.code}
                data-blocker={blocker.code}
                className={`${warningNoteClass} flex flex-col items-start gap-1 text-sm`}
              >
                <span>{blockerText(blocker)}</span>
                {blocker.lineIds[0] && (
                  <a href={`#line-${blocker.lineIds[0]}`} className={linkClass}>
                    {blocker.lineIds.length > 1
                      ? t("approval.seeFirstLine")
                      : t("approval.seeLine")}
                  </a>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {step === "confirm" && approval && (
        <ApproveConfirm
          approval={approval}
          locationName={chosen?.name ?? null}
          busy={busy}
          onConfirm={() =>
            void run(() => actions.approve(approval.locations.required ? locationId : null))
          }
          onCancel={() => setStep("idle")}
        />
      )}
      {step === "reject" && (
        <RejectForm
          busy={busy}
          onSubmit={(reason) => void run(() => actions.reject(reason))}
          onCancel={() => setStep("idle")}
        />
      )}
      {step === "idle" && (
        <div className="flex flex-wrap items-center gap-2">
          {approval && (
            <Button
              disabled={busy || !canApproveNow(approval, locationId)}
              aria-describedby={blockers.length > 0 ? blockersId : undefined}
              onClick={() => setStep("confirm")}
            >
              {t("approval.approve")}
            </Button>
          )}
          <Button variant="secondary" disabled={busy} onClick={() => setStep("reject")}>
            {t("approval.reject")}
          </Button>
        </div>
      )}
    </Card>
  );
}

/** The payable and the receipts, as the server previewed them. */
function Summary({ approval }: { approval: ApprovalInfo }) {
  const payable = payableText(approval.payable);
  const credit = creditText(approval.payable);
  const only = approval.locations.required
    ? null
    : (approval.locations.options.find((o) => o.id === approval.locations.defaultId)?.name ?? null);
  return (
    <div className="flex flex-col gap-1">
      {payable && (
        <p
          data-testid="approval-payable"
          className="num text-lg font-bold [overflow-wrap:anywhere]"
        >
          {payable}
        </p>
      )}
      {credit && (
        <p data-testid="approval-credit" className="num text-sm text-ink-muted">
          {credit}
        </p>
      )}
      <p data-testid="approval-receipts" className="num text-sm text-ink-muted">
        {receiptsText(approval, only)}
      </p>
    </div>
  );
}
