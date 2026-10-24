"use client";

import Link from "next/link";
import { useState } from "react";
import { Button, SuccessNote, linkClass } from "@/components/ui";
import { t, tn } from "@/lib/i18n";

/**
 * The bottom bar of an open count: the server's progress, ONE primary "Chiudi conteggio" and a quiet "Annulla
 * conteggio". Closing takes two taps: the second says what will be recorded (the server's counters) and that it
 * cannot be undone; cancelling has its own confirmation. After the close it shows one status note and a link to the
 * variance. No money anywhere.
 */
export function CloseCount({
  sessionId,
  linesCounted,
  linesTotal,
  linesWithDifference,
  busy,
  closed,
  onClose,
  onCancel,
  defaultConfirmingClose = false,
  defaultConfirmingCancel = false,
}: {
  sessionId: string;
  linesCounted: number;
  linesTotal: number;
  linesWithDifference: number;
  busy: boolean;
  /** Set once the count has been closed, with the number of differences the server recorded. */
  closed: { linesWithDifference: number } | null;
  onClose: () => void;
  onCancel: () => void;
  /** Start at the second step (used by the tests). */
  defaultConfirmingClose?: boolean;
  defaultConfirmingCancel?: boolean;
}) {
  const [confirmingClose, setConfirmingClose] = useState(defaultConfirmingClose);
  const [confirmingCancel, setConfirmingCancel] = useState(defaultConfirmingCancel);

  if (closed) {
    return (
      <div className="flex flex-col gap-3">
        <SuccessNote role="status">{tn("count.closed", closed.linesWithDifference)}</SuccessNote>
        <Link
          href={`/magazzino/conteggi/${sessionId}/scostamenti`}
          className={`${linkClass} self-start`}
        >
          {t("count.row.variance")}
        </Link>
      </div>
    );
  }

  const skipped = linesTotal - linesCounted;
  const willPost =
    linesWithDifference === 0
      ? t("count.close.willPost.none")
      : tn("count.close.willPost", linesWithDifference);
  const sentence = [
    willPost,
    skipped > 0 ? tn("count.close.skipped", skipped) : null,
    t("count.close.final"),
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="sticky bottom-0 z-10 flex flex-col gap-3 border-t border-rule bg-surface py-3">
      <p className="num font-bold">
        {t("count.progress", { counted: linesCounted, total: linesTotal })}
      </p>
      {confirmingClose ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm">{sentence}</p>
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy} onClick={onClose}>
              {t("count.close.confirm")}
            </Button>
            <Button variant="quiet" disabled={busy} onClick={() => setConfirmingClose(false)}>
              {t("count.back.step")}
            </Button>
          </div>
        </div>
      ) : confirmingCancel ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm">{t("count.cancel.confirmText")}</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" disabled={busy} onClick={onCancel}>
              {t("count.cancel.confirm")}
            </Button>
            <Button variant="quiet" disabled={busy} onClick={() => setConfirmingCancel(false)}>
              {t("count.back.step")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button disabled={busy} onClick={() => setConfirmingClose(true)}>
            {t("count.close")}
          </Button>
          <Button variant="quiet" disabled={busy} onClick={() => setConfirmingCancel(true)}>
            {t("count.cancel")}
          </Button>
        </div>
      )}
    </div>
  );
}
