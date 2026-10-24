import type { ReactNode } from "react";
import { Button, Card, Muted } from "@/components/ui";
import { t } from "@/lib/i18n";
import { courseLabel, groupLinesByCourse, sheetSummary } from "@/lib/orders/order-view";
import type { OrderLine } from "@/server/orders/output";
import { LineRow } from "./line-row";

/**
 * The order so far. A sticky bar at the foot of the screen ("Comanda · 7 righe", within thumb reach) opens the lines,
 * grouped by course; the line being edited shows its editor in place. Counting and grouping come from the pure helpers
 * of `order-view.ts`.
 */
export function OrderSheet({
  lines,
  expanded,
  onToggle,
  pendingIds,
  failedIds,
  editingId,
  onEdit,
  onRetry,
  onDiscard,
  renderEditor,
}: {
  lines: OrderLine[];
  expanded: boolean;
  onToggle: () => void;
  pendingIds: ReadonlySet<string>;
  failedIds: ReadonlySet<string>;
  editingId: string | null;
  onEdit: (id: string) => void;
  onRetry: (id: string) => void;
  onDiscard: (id: string) => void;
  renderEditor: (line: OrderLine) => ReactNode;
}) {
  const groups = groupLinesByCourse(lines);
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
                      editing={editingId === line.id}
                      onEdit={onEdit}
                      onRetry={onRetry}
                      onDiscard={onDiscard}
                    >
                      {renderEditor(line)}
                    </LineRow>
                  ))}
                </ul>
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
