"use client";

import { useState, type FormEvent } from "react";
import { Button, Field, TextInput } from "@/components/ui";
import { t } from "@/lib/i18n";
import { PAYABLE_REASON_MAX } from "@/server/payables/constants";

/**
 * "Annulla pagamento": a second tap asks for the reason (required, at most 200 characters) and
 * says the payment stays in the history. A paid payable can only be reopened this way.
 */
export function ReverseForm({
  busy,
  defaultOpen = false,
  onSubmit,
}: {
  busy: boolean;
  /** Starts at the second step (used by the tests). */
  defaultOpen?: boolean;
  /** Called with the trimmed reason. */
  onSubmit: (reason: string) => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [reason, setReason] = useState("");

  if (!open) {
    return (
      <div>
        <Button variant="secondary" disabled={busy} onClick={() => setOpen(true)}>
          {t("payables.reverse.start")}
        </Button>
      </div>
    );
  }

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (reason.trim()) onSubmit(reason.trim());
  };

  return (
    <form
      onSubmit={submit}
      aria-label={t("payables.reverse.title")}
      className="flex w-full flex-col gap-3 rounded-lg border border-rule p-3"
    >
      <p className="text-sm text-ink-muted">{t("payables.reverse.explain")}</p>
      <Field label={t("payables.reverse.reason")} hint={t("payables.reverse.hint")}>
        <TextInput
          value={reason}
          required
          maxLength={PAYABLE_REASON_MAX}
          autoComplete="off"
          onChange={(event) => setReason(event.target.value)}
        />
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="secondary" disabled={busy}>
          {t("payables.reverse.confirm")}
        </Button>
        <Button variant="quiet" disabled={busy} onClick={() => setOpen(false)}>
          {t("common.cancel")}
        </Button>
      </div>
    </form>
  );
}
