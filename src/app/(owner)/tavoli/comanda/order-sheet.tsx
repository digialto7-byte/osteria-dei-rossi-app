import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { StickyActionBar } from "@/components/sticky-action-bar";
import { Button, Card, Muted } from "@/components/ui";
import { t } from "@/lib/i18n";
import { barSend, fireGroups, sendLabel } from "@/lib/orders/fire-view";
import { courseLabel, foldedLabel, foldSent, sheetSummary } from "@/lib/orders/order-view";
import type { QueuedLine } from "@/lib/sync/overlay";
import type { Course } from "@/server/orders/constants";
import { LineRow } from "./line-row";
import { SendButtons } from "./send-buttons";

/**
 * The order so far (Direct comanda, docs/ux/p3-sala-waiter.md §10.2): "Comanda" is a card of the lines, open on arrival, above whatever the
 * page gives as `children` (the course tabs and the menu: lines first, menu second). A sticky bar at the foot of the screen (within thumb
 * reach) holds the summary ("Comanda · 7 righe", a secondary button) that scrolls back to the lines and focuses their heading and, when
 * something is ready, the one primary "Invia <portata> · n" (`barSend`: the selected course, else the first with drafts; never "a
 * seguire"); the send buttons in the list are secondary. The bar renders beside the card, so it sticks against the page. The lines are
 * grouped by course; the line being edited shows its editor in place. Counting and grouping come from the pure helpers
 * of `order-view.ts`. Each course with drafts ends with its send buttons (M19, `fire-view.ts` picks the ids); a sent line has
 * "Storna", whose dialog opens in place; a line voided after sending stays on the sheet, struck through. The lines are the server's
 * with the queued operations on top (M20): a line whose fire or void is already queued is not offered to the send buttons again.
 */
export function OrderSheet({
  lines,
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
  children,
}: {
  lines: QueuedLine[];
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
  /** What sits between the lines and the bar: the course tabs and the menu. */
  children?: ReactNode;
}) {
  const groups = foldSent(lines);
  // The courses whose sent lines the waiter has unfolded: local, folded again on each visit (Direct comanda, plan D14).
  const [unfolded, setUnfolded] = useState<ReadonlySet<Course>>(new Set());
  const toggleFold = (course: Course) =>
    setUnfolded((current) => {
      const next = new Set(current);
      if (!next.delete(course)) next.add(course);
      return next;
    });
  const renderLine = (line: QueuedLine) => (
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
  );
  // A draft whose fire or void is already queued has been sent as far as the phone is concerned: it gets no second button.
  const sendGroups = onSend
    ? fireGroups(lines.filter((line) => line.queue !== "fire" && line.queue !== "void"))
    : [];
  const next = onSend ? barSend(lines, course) : null;
  const primaryRef = useRef<HTMLButtonElement>(null);
  const summaryRef = useRef<HTMLButtonElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  // Focus belongs to the bar: a send takes the primary away (or changes its course), so focus goes back to a button that exists.
  const restoreFocus = useRef(false);
  useLayoutEffect(() => {
    if (!restoreFocus.current || sending) return;
    restoreFocus.current = false;
    (primaryRef.current ?? summaryRef.current)?.focus();
  });
  return (
    <>
      <Card role="group" aria-label={t("orders.line.list")} className="flex flex-col gap-3">
        <h2 ref={titleRef} tabIndex={-1} className="text-base font-bold">
          {t("orders.lines.title")}
        </h2>
        {groups.length === 0 ? (
          <Muted>{t("orders.lines.emptyHint")}</Muted>
        ) : (
          groups.map((group) => (
            <section key={group.course} className="flex flex-col gap-1">
              <h3 className="text-base font-bold text-ink-muted">{courseLabel(group.course)}</h3>
              {group.drafts.length > 0 && (
                <ul className="flex flex-col">{group.drafts.map(renderLine)}</ul>
              )}
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
              {group.sent.length > 0 && (
                <>
                  <button
                    type="button"
                    aria-expanded={unfolded.has(group.course)}
                    onClick={() => toggleFold(group.course)}
                    className="flex min-h-tap w-full items-center justify-between gap-2 rounded-lg px-1 text-left font-bold hover:bg-sunk"
                  >
                    <span>{foldedLabel(group.course, group.sent.length)}</span>
                    <span aria-hidden="true">▸</span>
                  </button>
                  {unfolded.has(group.course) && (
                    <ul className="flex flex-col">{group.sent.map(renderLine)}</ul>
                  )}
                </>
              )}
            </section>
          ))
        )}
      </Card>
      {children}
      <StickyActionBar>
        <Button
          ref={summaryRef}
          variant="secondary"
          onClick={() => {
            titleRef.current?.scrollIntoView({ block: "start" });
            titleRef.current?.focus({ preventScroll: true });
          }}
          comfort
        >
          {sheetSummary(lines)}
        </Button>
        {next && onSend && (
          <Button
            ref={primaryRef}
            disabled={sending}
            comfort
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
