import type { ReactNode } from "react";
import { Badge, Button } from "@/components/ui";
import { t } from "@/lib/i18n";
import { lineLabel } from "@/lib/orders/order-view";
import type { QueuedLine } from "@/lib/sync/overlay";
import type { OrderLine } from "@/server/orders/output";

/**
 * One line of the order: "2 × Spezzatino con polenta (demo)", with "Da dividere" and "Segue" badges and the note in
 * muted text. A draft line is a 44 px button that opens its editor; a line sent to the kitchen is locked, says "In cucina"
 * and has a "Storna" button (M19) that opens the void dialog below it; a line voided after it was sent is struck through and
 * says "Stornato"; a line still being sent says "Invio…". The editor or the void dialog, when open, is rendered below by
 * the sheet (`children`).
 */
export function LineRow({
  line,
  pending,
  failed = false,
  discarding = false,
  editing,
  voiding = false,
  onEdit,
  onVoid,
  onRetry,
  onDiscard,
  children,
}: {
  /** A line of the order; one from src/lib/sync/overlay carries what is waiting to be sent (`queue`). */
  line: OrderLine | QueuedLine;
  pending: boolean;
  /** The send failed for want of a connection: the same line id is sent again on "Riprova" (never a second line). */
  failed?: boolean;
  /** A discard of this line is waiting for the server: both buttons are off until it ends. */
  discarding?: boolean;
  editing: boolean;
  /** The void dialog of this line is open (rendered as `children`). */
  voiding?: boolean;
  onEdit: (id: string) => void;
  /** Opens the void dialog of a sent line; without it the sheet shows no "Storna" button. */
  onVoid?: (id: string) => void;
  onRetry?: (id: string) => void;
  onDiscard?: (id: string) => void;
  children?: ReactNode;
}) {
  const queue = "queue" in line ? line.queue : undefined;
  const queuedAddOpId = "queuedAddOpId" in line ? line.queuedAddOpId : undefined;
  // A line whose fire or void is queued is not edited any more: the edit would meet `fired` at replay.
  const editable = line.state === "draft" && !pending && queue !== "fire" && queue !== "void";
  const voided = line.state === "voided";
  const hasBadges =
    line.isShared ||
    line.segue ||
    line.state === "fired" ||
    voided ||
    pending ||
    queue !== undefined;
  const body = (
    <>
      <span className={`font-bold [overflow-wrap:anywhere]${voided ? " line-through" : ""}`}>
        {lineLabel(line.qty, line.name)}
      </span>
      {hasBadges && (
        <span className="flex flex-wrap gap-1.5">
          {pending && !failed && <Badge tone="info">{t("orders.line.pending")}</Badge>}
          {failed && <Badge tone="warning">{t("orders.line.failed")}</Badge>}
          {line.isShared && <Badge tone="neutral">{t("orders.line.shared")}</Badge>}
          {line.segue && <Badge tone="neutral">{t("orders.line.segue")}</Badge>}
          {line.state === "fired" && <Badge tone="success">{t("orders.line.fired")}</Badge>}
          {voided && <Badge tone="warning">{t("orders.line.voided")}</Badge>}
          {(queue === "add" || queue === "edit") && (
            <Badge tone="info">{t("sync.line.queued")}</Badge>
          )}
          {queue === "fire" && <Badge tone="info">{t("sync.line.queuedFire")}</Badge>}
          {queue === "void" && <Badge tone="warning">{t("sync.line.queuedVoid")}</Badge>}
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
      {line.state === "fired" && onVoid && (
        <div className="flex flex-wrap gap-3">
          <Button
            variant="danger"
            aria-label={t("orders.line.voidAria", { name: lineLabel(line.qty, line.name) })}
            aria-expanded={voiding}
            onClick={() => onVoid(line.id)}
          >
            {t("orders.line.void")}
          </Button>
        </div>
      )}
      {queuedAddOpId && !failed && onDiscard && (
        <div className="flex flex-wrap gap-3">
          <Button variant="quiet" disabled={discarding} onClick={() => onDiscard(line.id)}>
            {t("orders.line.discard")}
          </Button>
        </div>
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
      {(editing || voiding) && children}
    </li>
  );
}
