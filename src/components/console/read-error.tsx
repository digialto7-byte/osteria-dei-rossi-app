"use client";

import { Button, ErrorAlert } from "@/components/ui";
import { t } from "@/lib/i18n";

/**
 * A read that failed: the message, and a secondary "Riprova" that asks the screen to read again. While that read is in flight (`busy`) the
 * error stays mounted and the button is disabled, so the person's focus stays on it instead of dropping to the page.
 */
export function ReadError({
  message,
  onRetry,
  busy,
}: {
  message: string;
  onRetry: () => void;
  busy: boolean;
}) {
  return (
    <div className="flex flex-col items-start gap-3">
      <ErrorAlert message={message} />
      <Button variant="secondary" onClick={onRetry} disabled={busy}>
        {t("common.retry")}
      </Button>
    </div>
  );
}
