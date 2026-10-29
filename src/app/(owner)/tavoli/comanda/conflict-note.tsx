import { warningNoteClass } from "@/components/ui";
import { t } from "@/lib/i18n";
import { lineLabel } from "@/lib/orders/order-view";
import type { OrderLine } from "@/server/orders/output";

/**
 * The warning after a `conflict` (a colleague's later change won, or the line is locked): who changed it and when, in
 * the server's words, then the line as it is now ("Ora: 2 × Spezzatino con polenta (demo) · ben cotto"). The screen has
 * already replaced its copy with that line.
 */
export function ConflictNote({ message, line }: { message: string; line: OrderLine | null }) {
  return (
    <div role="alert" className={`${warningNoteClass} flex flex-col gap-1`}>
      <p className="font-bold">{message}</p>
      {line && (
        <p data-conflict-line-id={line.id} className="[overflow-wrap:anywhere]">
          {t("orders.conflict.now", {
            line: [lineLabel(line.qty, line.name), line.note].filter(Boolean).join(" · "),
          })}
        </p>
      )}
    </div>
  );
}
