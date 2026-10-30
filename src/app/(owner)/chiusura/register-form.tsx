"use client";

import { useState } from "react";
import { Button, ErrorAlert, Field, TextInput } from "@/components/ui";
import { t } from "@/lib/i18n";
import { parseEuroInput } from "@/lib/money/parse";

/**
 * "Totale del registratore di cassa" (M21 plan §3.6): the owner types the register's total as the RCH shows it ("1.234,50", "1234,5").
 * parseEuroInput turns it into the decimal string the API takes, with string operations only, so the value that is saved is the value
 * that was typed. A text that is not an amount sends nothing and says how to write one.
 */
export function RegisterForm({
  busy,
  error,
  onSave,
}: {
  busy: boolean;
  /** The server's refusal of the last save. */
  error: string | null;
  onSave: (registerTotal: string) => void;
}) {
  const [text, setText] = useState("");
  const [invalid, setInvalid] = useState(false);

  function save() {
    const parsed = parseEuroInput(text);
    if (parsed === null) return setInvalid(true);
    setInvalid(false);
    onSave(parsed);
  }

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <Field label={t("dayClose.register.label")}>
        <TextInput
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={text}
          aria-invalid={invalid || undefined}
          onChange={(event) => setText(event.target.value)}
        />
      </Field>
      <ErrorAlert message={invalid ? t("dayCloseError.register_total_invalid") : error} />
      <Button type="submit" disabled={busy} className="self-start">
        {t("dayClose.register.save")}
      </Button>
    </form>
  );
}
