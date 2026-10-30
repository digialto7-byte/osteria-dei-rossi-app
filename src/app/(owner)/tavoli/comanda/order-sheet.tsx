import type { ReactNode } from "react";
import { Button, Card, Muted } from "@/components/ui";
import { t } from "@/lib/i18n";
import { fireGroups } from "@/lib/orders/fire-view";
import { courseLabel, groupLinesByCourse, sheetSummary } from "@/lib/orders/order-view";
import type { QueuedLine } from "@/lib/sync/overlay";
import { LineRow } from "./line-row";
import { SendButtons } from "./send-buttons";

/**
 * The order so far. A sticky bar at the foot of the screen ("Comanda · 7 righe", within thumb reach) opens the lines,
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
  voidingId?: string | null;
  onVoid?: (id: string) => void;
  renderVoid?: (line: QueuedLine) => ReactNode;
}) {
  const groups = groupLinesByCourse(lines, true);
  // A draft whose fire or void is already queued has been sent as far as the phone is concerned: it gets no second button.
  const sendGroups = onSend
    ? fireGroups(lines.filter((line) => line.queue !== "fire" && line.queue !== "void"))
    : [];
  return (
    <div className="flex flex-col gap-3">
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
                      <SendButtons key={send.course} group={send} sending={null} onSend={onSend} />
                    ))}
              </section>
            ))
          )}
        </Card>
      )}
      <div className="sticky bottom-2 z-10">
        <Button aria-expanded={expanded} onClick={onToggle} className="w-full shadow-lg">
          {sheetSummary(lines)}
        </Button>
      </div>
    </div>
  );
}
