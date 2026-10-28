import type { ReactNode } from "react";
import { Button, Card, Muted } from "@/components/ui";
import { t } from "@/lib/i18n";
import { fireGroups } from "@/lib/orders/fire-view";
import { courseLabel, groupLinesByCourse, sheetSummary } from "@/lib/orders/order-view";
import type { Course } from "@/server/orders/constants";
import type { OrderLine } from "@/server/orders/output";
import { LineRow } from "./line-row";
import { SendButtons } from "./send-buttons";

const NONE: ReadonlySet<string> = new Set();

/**
 * The order so far. A sticky bar at the foot of the screen ("Comanda · 7 righe", within thumb reach) opens the lines,
 * grouped by course; the line being edited shows its editor in place. Counting and grouping come from the pure helpers
 * of `order-view.ts`. Each course with drafts ends with its send buttons (M19, `fire-view.ts` picks the ids); a sent line has
 * "Storna", whose dialog opens in place; a line voided after sending stays on the sheet, struck through.
 */
export function OrderSheet({
  lines,
  expanded,
  onToggle,
  pendingIds,
  failedIds,
  discardingIds = NONE,
  editingId,
  onEdit,
  onRetry,
  onDiscard,
  renderEditor,
  onSend,
  sending = null,
  voidingId = null,
  onVoid,
  renderVoid,
}: {
  lines: OrderLine[];
  expanded: boolean;
  onToggle: () => void;
  pendingIds: ReadonlySet<string>;
  failedIds: ReadonlySet<string>;
  discardingIds?: ReadonlySet<string>;
  editingId: string | null;
  onEdit: (id: string) => void;
  onRetry: (id: string) => void;
  onDiscard: (id: string) => void;
  renderEditor: (line: OrderLine) => ReactNode;
  /** Sends the given line ids (M19). Without it the sheet shows no send buttons. */
  onSend?: (ids: string[]) => void;
  /** The send in flight, if any: which course and which button. */
  sending?: { course: Course; segue: boolean } | null;
  voidingId?: string | null;
  onVoid?: (id: string) => void;
  renderVoid?: (line: OrderLine) => ReactNode;
}) {
  const groups = groupLinesByCourse(lines, true);
  const sendGroups = onSend ? fireGroups(lines, [...pendingIds, ...failedIds]) : [];
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
                      pending={pendingIds.has(line.id)}
                      failed={failedIds.has(line.id)}
                      discarding={discardingIds.has(line.id)}
                      editing={editingId === line.id}
                      voiding={voidingId === line.id}
                      onEdit={onEdit}
                      onVoid={onVoid}
                      onRetry={onRetry}
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
                        sending={
                          sending?.course === send.course
                            ? sending.segue
                              ? "segue"
                              : "normal"
                            : null
                        }
                        locked={sending !== null && sending.course !== send.course}
                        onSend={onSend}
                      />
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
