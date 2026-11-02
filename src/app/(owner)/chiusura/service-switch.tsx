"use client";

import { useState } from "react";
import { Button, ErrorAlert } from "@/components/ui";
import { t } from "@/lib/i18n";
import type { DayServices } from "@/server/services/output";

type Session = DayServices["sessions"][number];

const RADIO_LABEL = "flex min-h-tap cursor-pointer items-center gap-3";

/**
 * The sheet that moves one table to another service: a radio per service the table can have, "Automatico" (back to the opening time's service),
 * "Conferma" and "Annulla". Whether the move is allowed is the server's call (the day may have become final); its refusal comes back as `error`.
 */
export function ServiceSwitch({
  session,
  nameOf,
  busy,
  error,
  onConfirm,
  onCancel,
}: {
  session: Session;
  nameOf: (key: string) => string;
  busy: boolean;
  error: string | null;
  onConfirm: (serviceKey: string | null) => void;
  onCancel: () => void;
}) {
  const [choice, setChoice] = useState<string | null>(session.serviceKey);
  const options: Array<{ value: string | null; label: string }> = [
    ...session.choices.map((key) => ({ value: key, label: nameOf(key) })),
    { value: null, label: t("dayClose.services.auto") },
  ];
  return (
    <fieldset className="flex flex-col gap-3 rounded-card border border-rule bg-sunk p-3">
      <legend className="px-1 font-bold">
        {t("dayClose.services.sheet", { table: session.tableName })}
      </legend>
      {options.map((option) => (
        <label key={option.value ?? "auto"} className={RADIO_LABEL}>
          <input
            type="radio"
            name="serviceKey"
            checked={choice === option.value}
            disabled={busy}
            onChange={() => setChoice(option.value)}
            className="size-5 accent-accent"
          />
          {option.label}
        </label>
      ))}
      <div aria-live="polite">
        <ErrorAlert message={error} />
      </div>
      <div className="flex flex-wrap gap-3">
        <Button disabled={busy} onClick={() => onConfirm(choice)}>
          {t("dayClose.services.confirm")}
        </Button>
        <Button variant="secondary" disabled={busy} onClick={onCancel}>
          {t("dayClose.services.cancel")}
        </Button>
      </div>
    </fieldset>
  );
}
