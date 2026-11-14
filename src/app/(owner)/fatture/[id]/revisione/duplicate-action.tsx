"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { Button, ErrorAlert, linkClass, warningNoteClass } from "@/components/ui";
import { t } from "@/lib/i18n";
import { duplicateGuidance, type DuplicateGuidance } from "@/lib/invoices/duplicate-view";
import type { DuplicateBannerView } from "@/lib/invoices/xml-review-view";
import type { InvoiceReview } from "@/server/invoices/review-types";
import type { Outcome } from "./actions";
import { RejectForm } from "./reject-form";
import { ReplaceSheet } from "./replace-sheet";

/** The duplicate area as drawn: the button is off while its request is on its way. Display only. */
export function DuplicateActionView({
  guidance,
  busy,
  error,
  onClear,
}: {
  guidance: DuplicateGuidance;
  busy: boolean;
  error: string | null;
  onClear: () => void;
}) {
  const { action, hint } = guidance;
  if (!action && !hint) return null;
  return (
    <div className="flex flex-col items-start gap-2">
      <ErrorAlert message={error} />
      {hint && <p className="text-sm">{t(hint)}</p>}
      {action && (
        <Button variant="secondary" disabled={busy} aria-busy={busy} onClick={onClear}>
          {action.label}
        </Button>
      )}
    </div>
  );
}

/**
 * "Non è un doppione di FT 40 del 01/09/2026": declares the look-alike the review names (the duplicate
 * blocker of the approval preview), and only that one. A second tap while the request is on its way is
 * ignored: the button is disabled, and a ref covers the moment before the disabled state is drawn.
 * The rule is in `duplicateGuidance`.
 */
export function DuplicateAction({
  invoice,
  partner,
  clear,
}: {
  invoice: InvoiceReview["invoice"];
  partner: InvoiceReview["duplicatePartner"];
  clear: (partnerId: string) => Outcome;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const guidance = duplicateGuidance(invoice.status, partner);
  const partnerId = guidance.action?.partnerId;

  async function onClear() {
    if (!partnerId || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      setError(await clear(partnerId));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return <DuplicateActionView guidance={guidance} busy={busy} error={error} onClear={onClear} />;
}

/** What the duplicate banner of an XML review asks of the screen. Each call ends in a fresh review (or a message). */
export interface BannerActions {
  clear(partnerId: string): Outcome;
  /** `reason` is already trimmed; null when the field was left empty. */
  reject(reason: string | null): Outcome;
  /** "Usa il file XML al posto del PDF": the screen sends `{replaces: partnerId}`. */
  replace(partnerId: string): Outcome;
}

type Step = "idle" | "replace" | "reject";

/**
 * The duplicate banner (spec §5.5), above the data card because it decides whether the rest matters: what the look-alike is, the two
 * amounts in words, and the actions. The words come from `duplicateBanner`. One request at a time: the buttons are off while one is on its way.
 */
export function DuplicateBanner({
  view,
  actions,
}: {
  view: DuplicateBannerView;
  actions: BannerActions;
}) {
  const [step, setStep] = useState<Step>("idle");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);

  async function run(action: () => Outcome) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const failure = await action();
      if (failure) setError(failure);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  const rejecting = () => setStep("reject");
  return (
    <section
      data-testid="duplicate-banner"
      data-banner={view.id}
      className={`${warningNoteClass} flex flex-col items-start gap-3`}
    >
      <p className="font-bold">{view.text}</p>
      <Link href={view.partnerHref} className={linkClass}>
        {`${view.partnerLabel} ›`}
      </Link>
      {view.amounts && <p className="num">{view.amounts}</p>}
      {view.note && <p className="text-sm">{view.note}</p>}
      {step === "idle" && (
        <div className="flex w-full flex-col items-start gap-2">
          {view.primary === "replace" ? (
            <Button onClick={() => setStep("replace")}>{view.primaryLabel}</Button>
          ) : (
            <Button onClick={rejecting}>{view.primaryLabel}</Button>
          )}
          {view.canClear && (
            <Button
              variant="secondary"
              disabled={busy}
              aria-busy={busy}
              onClick={() => void run(() => actions.clear(view.partnerId))}
            >
              {t("review.xml.notDuplicate")}
            </Button>
          )}
          {view.rejectLabel && (
            <Button variant="quiet" onClick={rejecting}>
              {view.rejectLabel}
            </Button>
          )}
        </div>
      )}
      {step === "replace" && (
        <ReplaceSheet
          busy={busy}
          error={error}
          onConfirm={() => void run(() => actions.replace(view.partnerId))}
          onCancel={() => {
            setError(null);
            setStep("idle");
          }}
        />
      )}
      {step === "reject" && (
        <RejectForm
          busy={busy}
          onSubmit={(reason) => void run(() => actions.reject(reason))}
          onCancel={() => {
            setError(null);
            setStep("idle");
          }}
        />
      )}
      {step !== "replace" && <ErrorAlert message={error} />}
    </section>
  );
}
