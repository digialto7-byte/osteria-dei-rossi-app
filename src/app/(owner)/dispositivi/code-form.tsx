"use client";

import { useState, type FormEvent } from "react";
import { Button, Card, ErrorAlert, Field, SubHeading, TextInput } from "@/components/ui";
import { apiJson } from "@/lib/api/client";
import { t } from "@/lib/i18n";

export interface NewCode {
  display: string;
  label: string;
  expiresAt: string;
}

/** "Nuovo codice": names the device and asks the server for a single-use code. */
export function CodeForm({ onCreated }: { onCreated: (code: NewCode) => void }) {
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const label = String(new FormData(form).get("label") ?? "").trim();
    setBusy(true);
    const result = await apiJson<NewCode>("/api/devices/enrolment-codes", {
      method: "POST",
      body: { label },
    });
    setBusy(false);
    if (!result.ok) return setMessage(result.error.message);
    setMessage(null);
    form.reset();
    onCreated(result.data);
  }

  return (
    <Card>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <SubHeading>{t("devices.newCode")}</SubHeading>
        <Field label={t("devices.label")} hint={t("devices.labelHint")}>
          <TextInput name="label" type="text" autoComplete="off" maxLength={60} required />
        </Field>
        <ErrorAlert message={message} />
        <Button type="submit" disabled={busy}>
          {t("devices.createCode")}
        </Button>
      </form>
    </Card>
  );
}
