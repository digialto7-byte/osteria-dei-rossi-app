import { useLayoutEffect, useRef, type ReactNode } from "react";
import { StickyActionBar } from "@/components/sticky-action-bar";
import { Button, Card, Muted } from "@/components/ui";
import { t } from "@/lib/i18n";
import { barSend, fireGroups, sendLabel } from "@/lib/orders/fire-view";
import { courseLabel, groupLinesByCourse, sheetSummary } from "@/lib/orders/order-view";
import type { QueuedLine } from "@/lib/sync/overlay";
import type { Course } from "@/server/orders/constants";
import { LineRow } from "./line-row";
import { SendButtons } from "./send-buttons";

/**
 * The order so far. A sticky bar at the foot of the screen (within thumb reach) holds the summary ("Comanda · 7 righe", a secondary
 * button) that opens the lines and, when something is ready, the one primary "Invia <portata> · n" (`barSend`: the selected course,
 * else the first with drafts; never "a seguire"). It renders beside the card, so it sticks against the page. The lines are,
 * grouped by course; the line being edited shows its editor in place. Counting and grouping come from the pure helpers
 * of `order-view.ts`. Each course with drafts ends with its send buttons (M19, `fire-view.ts` picks the ids); a sent line has
 * "Storna", whose dialog opens in place; a line voided after sending stays on the sheet, struck through. The lines are the server's
 * with the queued operations on top (M20): a line whose fire or void is already queued is not offered to the send buttons again.
 */
export function OrderSheet({
  lines,
  expanded,
  onToggle,
  editingId,
  onEdit,
  onDiscard,
  renderEditor,
  onSend,
  course,
  sending,
  voidingId = null,
  onVoid,
  renderVoid,
}: {
  lines: QueuedLine[];
  expanded: boolean;
  onToggle: () => void;
  editingId: string | null;
  onEdit: (id: string) => void;
  /** "Scarta" on a line whose add is still in the outbox. */
  onDiscard: (id: string) => void;
  renderEditor: (line: QueuedLine) => ReactNode;
  /** Queues the given line ids for the kitchen (M19, M20). Without it the sheet shows no send buttons. */
  onSend?: (ids: string[]) => void;
  /** The selected course tab: the bar sends it first (W-b). */
  course: Course;
  /** A send is being queued: the bar says "Invio…" and every send button waits. */
  sending: boolean;
  voidingId?: string | null;
  onVoid?: (id: string) => void;
  renderVoid?: (line: QueuedLine) => ReactNode;
}) {
  const groups = groupLinesByCourse(lines, true);
  // A draft whose fire or void is already queued has been sent as far as the phone is concerned: it gets no second button.
  const sendGroups = onSend
    ? fireGroups(lines.filter((line) => line.queue !== "fire" && line.queue !== "void"))
    : [];
  const next = onSend ? barSend(lines, course) : null;
  const primaryRef = useRef<HTMLButtonElement>(null);
  const summaryRef = useRef<HTMLButtonElement>(null);
  // Focus belongs to the bar: a send takes the primary away (or changes its course), so focus goes back to a button that exists.
  const restoreFocus = useRef(false);
  useLayoutEffect(() => {
    if (!restoreFocus.current || sending) return;
    restoreFocus.current = false;
    (primaryRef.current ?? summaryRef.current)?.focus();
  });
  return (
    <>
      {expanded && (
        <Card role="group" aria-label={t("orders.line.list")} className="flex flex-col gap-3">
          {groups.length === 0 ? (
            <Muted>{t("orders.empty")}</Muted>
          ) : (
            groups.map((group) => (
              <section key={group.course} className="flex flex-col gap-1">
                <h3 className="text-base font-bold text-ink-muted">{courseLabel(group.course)}</h3>
                <ul className="flex flex-col">
                  {group.lines.map((line) => (
                    <LineRow
                      key={line.id}
                      line={line}
                      editing={editingId === line.id}
                      voiding={voidingId === line.id}
                      onEdit={onEdit}
                      onVoid={onVoid}
                      onDiscard={onDiscard}
                    >
                      {voidingId === line.id && renderVoid ? renderVoid(line) : renderEditor(line)}
                    </LineRow>
                  ))}
                </ul>
                {onSend &&
                  sendGroups
                    .filter((send) => send.course === group.course)
                    .map((send) => (
                      <SendButtons
                        key={send.course}
                        group={send}
                        sending={null}
                        locked={sending}
                        onSend={onSend}
                      />
                    ))}
              </section>
            ))
          )}
        </Card>
      )}
      <StickyActionBar>
        <Button
          ref={summaryRef}
          variant="secondary"
          aria-expanded={expanded}
          onClick={onToggle}
          className="w-full"
        >
          {sheetSummary(lines)}
        </Button>
        {next && onSend && (
          <Button
            ref={primaryRef}
            disabled={sending}
            className="w-full"
            onClick={(event) => {
              restoreFocus.current = document.activeElement === event.currentTarget;
              onSend(next.ids);
            }}
          >
            {sending ? t("orders.send.sending") : sendLabel(next.course, next.ids.length)}
          </Button>
        )}
      </StickyActionBar>
    </>
  );
}
