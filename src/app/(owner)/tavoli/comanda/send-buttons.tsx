"use client";

import { Button, Muted } from "@/components/ui";
import { t } from "@/lib/i18n";
import { sendAriaLabel, sendLabel, sendSegueLabel, type FireGroup } from "@/lib/orders/fire-view";

/**
 * The send buttons that end a course of the sheet: "Invia primi · 2" for the confirmed drafts, "Invia a seguire · 1" for
 * the segue ones (the waiter calls them later). Each sends exactly the ids of its group. While a line of the course is
 * still being sent, or failed, both wait and say why: a line that is not on the server is never sent. While a send is in
 * flight the pressed button says "Invio…" and both are off (firing moves stock: no optimistic UI, M19 plan §4).
 */
export function SendButtons({
  group,
  sending,
  locked = false,
  onSend,
}: {
  group: FireGroup;
  sending: "normal" | "segue" | null;
  /** Another course is being sent: these buttons wait too (one send at a time), without changing their words. */
  locked?: boolean;
  onSend: (ids: string[]) => void;
}) {
  const { course, normalIds, segueIds, blocked } = group;
  if (normalIds.length === 0 && segueIds.length === 0 && !blocked) return null;
  const off = blocked || locked || sending !== null;
  return (
    <div className="flex flex-col gap-2 pt-1">
      <div className="flex flex-wrap gap-3">
        {normalIds.length > 0 && (
          <Button
            aria-label={sendAriaLabel(course, normalIds.length, false)}
            disabled={off}
            onClick={() => onSend(normalIds)}
          >
            {sending === "normal" ? t("orders.send.sending") : sendLabel(course, normalIds.length)}
          </Button>
        )}
        {segueIds.length > 0 && (
          <Button
            variant="secondary"
            aria-label={sendAriaLabel(course, segueIds.length, true)}
            disabled={off}
            onClick={() => onSend(segueIds)}
          >
            {sending === "segue" ? t("orders.send.sending") : sendSegueLabel(segueIds.length)}
          </Button>
        )}
      </div>
      {blocked && <Muted>{t("orders.send.wait")}</Muted>}
    </div>
  );
}
