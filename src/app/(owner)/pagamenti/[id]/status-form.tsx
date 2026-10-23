"use client";

import { useState, type FormEvent } from "react";
import { Button, Field, TextInput } from "@/components/ui";
import { t } from "@/lib/i18n";
import { buildStatusBody } from "@/lib/payables/payable-view";
import { PAYABLE_REASON_MAX } from "@/server/payables/constants";
import type { PatchPayableBody } from "@/server/payables/schemas";
import type { PayableStatus } from "@/server/payables/types";

/** The order the actions are offered in; each shows only when the server lists the status. */
const ACTIONS = ["scheduled", "disputed", "open"] as const;

/**
 * The status form of an unpaid payable. It offers exactly the statuses in `allowed` (the server's
 * transition matrix), so the screen never decides what is possible. "Segna come pagata" is the one
 * primary button and submits the form; the other moves are plain buttons.
 */
export function StatusForm({
  allowed,
  today,
  busy,
  onSubmit,
}: {
  allowed: PayableStatus[];
  /** The venue's today, from the server: the default payment date. */
  today: string;
  busy: boolean;
  onSubmit: (body: PatchPayableBody) => void;
}) {
  const [paidOn, setPaidOn] = useState(today);
  const [note, setNote] = useState("");
  if (allowed.length === 0) return null;

  const send = (status: PayableStatus) => onSubmit(buildStatusBody(status, { paidOn, note }));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    send("paid");
  };

  return (
    <form
      onSubmit={submit}
      aria-label={t("payables.form.title")}
      className="flex w-full flex-col gap-3 rounded-lg border border-rule p-3"
    >
      {allowed.includes("paid") && (
        <Field label={t("payables.form.paidOn")}>
          <TextInput
            type="date"
            value={paidOn}
            max={today}
            required
            onChange={(event) => setPaidOn(event.target.value)}
          />
        </Field>
      )}
      <Field label={t("payables.form.note")} hint={t("payables.form.noteHint")}>
        <TextInput
          value={note}
          maxLength={PAYABLE_REASON_MAX}
          autoComplete="off"
          onChange={(event) => setNote(event.target.value)}
        />
      </Field>
      <div className="flex flex-wrap gap-2">
        {allowed.includes("paid") && (
          <Button type="submit" disabled={busy}>
            {t("payables.action.paid")}
          </Button>
        )}
        {ACTIONS.filter((status) => allowed.includes(status)).map((status) => (
          <Button
            key={status}
            variant={status === "open" ? "quiet" : "secondary"}
            disabled={busy}
            onClick={() => send(status)}
          >
            {t(`payables.action.${status}`)}
          </Button>
        ))}
      </div>
    </form>
  );
}
