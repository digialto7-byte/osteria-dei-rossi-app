"use client";

import { useState } from "react";
import { Button, Field, Select } from "@/components/ui";
import { t } from "@/lib/i18n";
import { voidReasonOptions } from "@/lib/orders/fire-view";
import { VOID_REASONS, type VoidReason } from "@/server/orders/constants";
import type { OrderLine } from "@/server/orders/output";

/**
 * "Storna piatto" for a line that was sent, in place under the line (like the line editor). A coded reason is required and
 * none is preselected: the waiter has to choose. The hint says what a void does to stock, in words and without a figure
 * (the waiter never sees a cost). The page sends `{reason, clientUpdatedAt}`.
 */
export function VoidDialog({
  busy,
  onConfirm,
  onCancel,
}: {
  line: OrderLine;
  busy: boolean;
  onConfirm: (reason: VoidReason) => void;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState("");
  const chosen = (VOID_REASONS as readonly string[]).includes(reason)
    ? (reason as VoidReason)
    : null;
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-rule bg-sunk p-3">
      <Field label={t("orders.void.reasonLabel")} hint={t("orders.void.hint")}>
        <Select value={reason} disabled={busy} onChange={(event) => setReason(event.target.value)}>
          <option value="">{t("orders.void.choose")}</option>
          {voidReasonOptions().map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </Field>
      <div className="flex flex-wrap gap-3">
        <Button
          variant="danger"
          disabled={busy || chosen === null}
          onClick={() => chosen !== null && onConfirm(chosen)}
        >
          {t("orders.void.confirm")}
        </Button>
        <Button variant="secondary" disabled={busy} onClick={onCancel}>
          {t("orders.void.cancel")}
        </Button>
      </div>
    </div>
  );
}
