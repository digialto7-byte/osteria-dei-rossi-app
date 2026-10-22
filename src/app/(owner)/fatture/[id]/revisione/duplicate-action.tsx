"use client";

import { useRef, useState } from "react";
import { Button, ErrorAlert } from "@/components/ui";
import { t } from "@/lib/i18n";
import { duplicateGuidance, type DuplicateGuidance } from "@/lib/invoices/duplicate-view";
import type { InvoiceReview } from "@/server/invoices/review-types";
import type { Outcome } from "./actions";

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
