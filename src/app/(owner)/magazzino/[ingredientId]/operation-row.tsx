"use client";

import { useState } from "react";
import { Badge, Button, LedgerRow } from "@/components/ui";
import { t } from "@/lib/i18n";
import { formatSignedQty, movementTypeWord } from "@/lib/stock/stock-view";
import { formatDateTime } from "@/lib/time/format";
import { reasonLabel } from "@/server/stock/reasons";
import type { StockOperation } from "@/server/stock/types";

function lotText(line: StockOperation["lines"][number]): string {
  if (line.rawLotId === null) return t("stock.history.noLot");
  return line.lotCode ? t("stock.history.lot", { code: line.lotCode }) : t("stock.lot.noCode");
}

/**
 * One operation of the history: its type word, the reason of a waste, a line per movement, who and when, and an
 * "Annullato" badge once reversed. "Annulla" appears only when the server says the operation is reversible; a second
 * tap confirms and says the original stays in the history. Quantities only, never a cost.
 */
export function OperationRow({
  operation,
  busy,
  defaultConfirming = false,
  onReverse,
}: {
  operation: StockOperation;
  busy: boolean;
  /** Starts at the second step (used by the tests). */
  defaultConfirming?: boolean;
  onReverse: (operation: StockOperation) => void;
}) {
  const [confirming, setConfirming] = useState(defaultConfirming);
  const rowId = `op-${operation.operationId}`;
  const who = operation.byMe
    ? t("stock.history.byYou")
    : (operation.byName ?? t("stock.history.byColleague"));
  return (
    <LedgerRow id={rowId} className="flex flex-col gap-1.5 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="neutral">
          {movementTypeWord(operation.type, operation.isReversal, undefined, operation.refType)}
        </Badge>
        {operation.reasonCode && (
          <span className="font-bold">{reasonLabel(operation.reasonCode)}</span>
        )}
        {operation.reversedByOperationId && <Badge tone="neutral">{t("stock.op.reversed")}</Badge>}
      </div>
      {operation.lines.map((line) => (
        <p key={line.movementId} className="num text-sm [overflow-wrap:anywhere]">
          {[formatSignedQty(line.qty, operation.unit), line.locationName, lotText(line)].join(
            " · ",
          )}
        </p>
      ))}
      <p className="num text-sm text-ink-muted">
        {formatDateTime(new Date(operation.createdAt))} · {who}
      </p>
      {operation.reversible &&
        (confirming ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-ink-muted">{t("stock.op.confirmText")}</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" disabled={busy} onClick={() => onReverse(operation)}>
                {t("stock.op.confirm")}
              </Button>
              <Button variant="quiet" disabled={busy} onClick={() => setConfirming(false)}>
                {t("stock.op.back")}
              </Button>
            </div>
          </div>
        ) : (
          <div>
            <Button
              variant="secondary"
              disabled={busy}
              aria-describedby={rowId}
              onClick={() => setConfirming(true)}
            >
              {t("stock.op.reverse")}
            </Button>
          </div>
        ))}
    </LedgerRow>
  );
}
