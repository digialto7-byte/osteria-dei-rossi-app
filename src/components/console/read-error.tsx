"use client";

import { Button, ErrorAlert } from "@/components/ui";
import { t } from "@/lib/i18n";

/** A read that failed: the message, and a secondary "Riprova" that asks the screen to read again. */
export function ReadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-start gap-3">
      <ErrorAlert message={message} />
      <Button variant="secondary" onClick={onRetry}>
        {t("common.retry")}
      </Button>
    </div>
  );
}
