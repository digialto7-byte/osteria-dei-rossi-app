"use client";

import { useState } from "react";
import { Button, ErrorAlert } from "@/components/ui";
import { t } from "@/lib/i18n";
import { duplicateGuidance } from "@/lib/invoices/duplicate-view";
import type { InvoiceReview } from "@/server/invoices/review-types";
import type { Outcome } from "./actions";

/**
 * "Non è un doppione": shown when the invoice is a duplicate, or when the approval preview is blocked by
 * a look-alike the owner has not declared a different document (the server declares the first one and
 * then shows the next). Display only: the rule is in `duplicateGuidance`.
 */
export function DuplicateAction({
  invoice,
  approval,
  clear,
}: {
  invoice: InvoiceReview["invoice"];
  approval: InvoiceReview["approval"];
  clear: () => Outcome;
}) {
  const [error, setError] = useState<string | null>(null);
  const { canClear, hint } = duplicateGuidance(invoice, approval);
  if (!canClear && !hint) return null;
  return (
    <div className="flex flex-col items-start gap-2">
      <ErrorAlert message={error} />
      {hint && <p className="text-sm">{t(hint)}</p>}
      {canClear && (
        <Button variant="secondary" onClick={async () => setError(await clear())}>
          {t("review.notDuplicate")}
        </Button>
      )}
    </div>
  );
}
