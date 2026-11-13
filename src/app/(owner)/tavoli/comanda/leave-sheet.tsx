"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui";
import { useFocusIntoView } from "@/components/use-focus-into-view";
import { t } from "@/lib/i18n";
import { sendLabel } from "@/lib/orders/fire-view";
import type { Course } from "@/server/orders/constants";

/**
 * The sheet a waiter sees on leaving a table with dishes not sent (QW12): "2 piatti non inviati", one "Invia <portata> · n" per course
 * (the first course in service order is the primary action, the others are secondary), "Esci comunque" and "Resta al tavolo".
 * "Esci comunque" always completes the exit in one tap. Escape, "Resta al tavolo" and a tap outside stay. The groups come from
 * `unsentGroups` (the ids each course's "Invia" button would send); the sheet only words and reports taps. Same classes as the
 * weight sheet, existing tokens only.
 */
export function LeaveSheet({
  groups,
  onSend,
  onLeave,
  onStay,
}: {
  groups: { course: Course; ids: string[] }[];
  onSend: (ids: string[]) => void;
  onLeave: () => void;
  onStay: () => void;
}) {
  const title = useFocusIntoView<HTMLHeadingElement>();
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onStay();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onStay]);

  const count = groups.reduce((sum, group) => sum + group.ids.length, 0);
  const heading = t(count === 1 ? "orders.leave.title.one" : "orders.leave.title.other", { count });
  return (
    <>
      <div
        aria-hidden="true"
        data-slot="leave-scrim"
        className="fixed inset-0 z-20 bg-ink/40"
        onClick={onStay}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="leave-title"
        className="fixed inset-x-0 bottom-0 z-30 flex flex-col gap-3 rounded-t-2xl border-t border-rule-strong bg-surface p-4 shadow-lg"
      >
        <h2 id="leave-title" ref={title} tabIndex={-1} className="text-lg font-bold outline-none">
          {heading}
        </h2>
        <div className="flex flex-col gap-3">
          {groups.map((group, index) => (
            <Button
              key={group.course}
              variant={index === 0 ? "primary" : "secondary"}
              onClick={() => onSend(group.ids)}
            >
              {sendLabel(group.course, group.ids.length)}
            </Button>
          ))}
          <Button variant="secondary" onClick={onLeave}>
            {t("orders.leave.leave")}
          </Button>
          <Button variant="quiet" onClick={onStay}>
            {t("orders.leave.stay")}
          </Button>
        </div>
      </div>
    </>
  );
}
