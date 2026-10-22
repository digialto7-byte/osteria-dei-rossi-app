"use client";

import { useState, type FormEvent } from "react";
import { Button, Field, TextInput } from "@/components/ui";
import { t } from "@/lib/i18n";

const MAX_REASON = 200;

/**
 * "Rifiuta": an optional reason (at most 200 characters, shown to whoever reads the audit trail,
 * so the hint asks for no personal data) and a second tap to confirm. A rejection is final.
 */
export function RejectForm({
  busy,
  onSubmit,
  onCancel,
}: {
  busy: boolean;
  /** Called with the trimmed reason, or null when it is empty. */
  onSubmit: (reason: string | null) => void;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState("");

  function submit(event: FormEvent) {
    event.preventDefault();
    onSubmit(reason.trim() || null);
  }

  return (
    <form
      onSubmit={submit}
      aria-label={t("approval.rejectTitle")}
      className="flex w-full flex-col gap-3 rounded-lg border border-rule p-3"
    >
      <p className="text-sm text-ink-muted">{t("approval.rejectFinal")}</p>
      <Field label={t("approval.rejectReason")} hint={t("approval.rejectHint")}>
        <TextInput
          value={reason}
          maxLength={MAX_REASON}
          autoComplete="off"
          onChange={(event) => setReason(event.target.value)}
        />
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy}>
          {t("approval.confirmReject")}
        </Button>
        <Button variant="quiet" disabled={busy} onClick={onCancel}>
          {t("common.cancel")}
        </Button>
      </div>
    </form>
  );
}
