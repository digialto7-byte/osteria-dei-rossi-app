import type { ReactNode } from "react";
import { Badge, Button } from "@/components/ui";
import { t } from "@/lib/i18n";
import { lineLabel } from "@/lib/orders/order-view";
import type { OrderLine } from "@/server/orders/output";

/**
 * One line of the order: "2 × Spezzatino con polenta (demo)", with "Da dividere" and "Segue" badges and the note in
 * muted text. A draft line is a 44 px button that opens its editor; a line sent to the kitchen is locked and says so; a
 * line still being sent says "Invio…". The editor, when open, is rendered below by the sheet (`children`).
 */
export function LineRow({
  line,
  pending,
  failed = false,
  discarding = false,
  editing,
  onEdit,
  onRetry,
  onDiscard,
  children,
}: {
  line: OrderLine;
  pending: boolean;
  /** The send failed for want of a connection: the same line id is sent again on "Riprova" (never a second line). */
  failed?: boolean;
  /** A discard of this line is waiting for the server: both buttons are off until it ends. */
  discarding?: boolean;
  editing: boolean;
  onEdit: (id: string) => void;
  onRetry?: (id: string) => void;
  onDiscard?: (id: string) => void;
  children?: ReactNode;
}) {
  const editable = line.state === "draft" && !pending;
  const body = (
    <>
      <span className="font-bold [overflow-wrap:anywhere]">{lineLabel(line.qty, line.name)}</span>
      {(line.isShared || line.segue || line.state === "fired" || pending) && (
        <span className="flex flex-wrap gap-1.5">
          {pending && !failed && <Badge tone="info">{t("orders.line.pending")}</Badge>}
          {failed && <Badge tone="warning">{t("orders.line.failed")}</Badge>}
          {line.isShared && <Badge tone="neutral">{t("orders.line.shared")}</Badge>}
          {line.segue && <Badge tone="neutral">{t("orders.line.segue")}</Badge>}
          {line.state === "fired" && <Badge tone="success">{t("orders.line.fired")}</Badge>}
        </span>
      )}
      {line.note && (
        <span className="text-sm text-ink-muted [overflow-wrap:anywhere]">{line.note}</span>
      )}
    </>
  );
  return (
    <li
      data-line-id={line.id}
      className="flex flex-col gap-2 border-b border-rule py-1 last:border-b-0"
    >
      {editable ? (
        <button
          type="button"
          aria-label={t("orders.line.edit", { name: lineLabel(line.qty, line.name) })}
          aria-expanded={editing}
          onClick={() => onEdit(line.id)}
          className="flex min-h-tap w-full flex-col items-start justify-center gap-1 rounded-lg px-1 text-left hover:bg-sunk"
        >
          {body}
        </button>
      ) : (
        <div className="flex min-h-tap flex-col items-start justify-center gap-1 px-1">{body}</div>
      )}
      {failed && (
        <div className="flex flex-wrap gap-3">
          <Button variant="secondary" disabled={discarding} onClick={() => onRetry?.(line.id)}>
            {t("orders.line.retry")}
          </Button>
          <Button variant="quiet" disabled={discarding} onClick={() => onDiscard?.(line.id)}>
            {t("orders.line.discard")}
          </Button>
        </div>
      )}
      {editing && children}
    </li>
  );
}
