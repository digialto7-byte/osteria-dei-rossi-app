"use client";

import { useState } from "react";
import { Button, ErrorAlert } from "@/components/ui";
import { t } from "@/lib/i18n";

/**
 * A read that failed: the message, and a secondary "Riprova" that asks the screen to read again. While that read is in flight (`busy`) the
 * error stays mounted, marked `aria-busy`, and the button is aria-disabled and ignores clicks. It is not `disabled`: a focused button that
 * becomes disabled loses focus to the page.
 *
 * A retry that fails with the same message changes nothing on screen, so a visually hidden polite status (mounted from the first render, so
 * a text change is announced) says «Ancora nessuna risposta» once a retry has run and the error is still here. It is emptied while the next
 * retry runs, so every repeat is a new announcement. When a retry succeeds the whole error unmounts.
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
  const [retried, setRetried] = useState(false);
  if (busy && !retried) setRetried(true);
  return (
    <div className="flex flex-col items-start gap-3" aria-busy={busy || undefined}>
      <ErrorAlert message={message} />
      <p role="status" className="sr-only">
        {retried && !busy ? t("console.retryAgain") : ""}
      </p>
      <Button
        variant="secondary"
        onClick={busy ? undefined : onRetry}
        aria-disabled={busy || undefined}
      >
        {t("common.retry")}
      </Button>
    </div>
  );
}
