"use client";

import { useState } from "react";
import { Button, ErrorAlert } from "@/components/ui";
import { t } from "@/lib/i18n";
import type { InvoiceReview } from "@/server/invoices/review-types";
import type { Outcome } from "./actions";

/** "Non è un doppione": shown when the invoice is flagged as a duplicate, or warned about. */
export function DuplicateAction({
  invoice,
  clear,
}: {
  invoice: InvoiceReview["invoice"];
  clear: () => Outcome;
}) {
  const [error, setError] = useState<string | null>(null);
  const flagged =
    (invoice.status === "duplicate" && invoice.duplicateOf) ||
    (invoice.status === "review" && invoice.duplicateWarningOf);
  if (!flagged) return null;
  return (
    <div className="flex flex-col items-start gap-2">
      <ErrorAlert message={error} />
      <Button variant="secondary" onClick={async () => setError(await clear())}>
        {t("review.notDuplicate")}
      </Button>
    </div>
  );
}
