"use client";

import { useState, type FormEvent } from "react";
import { Button, ErrorAlert, Field, SuccessNote, TextInput } from "@/components/ui";
import { t } from "@/lib/i18n";

type Status = "idle" | "sending" | "sent" | "error";

export function LoginForm({ next }: { next: string | undefined }) {
  const [status, setStatus] = useState<Status>("idle");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = new FormData(event.currentTarget).get("email");
    setStatus("sending");
    const response = await fetch("/api/auth/magic-link", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, next }),
    }).catch(() => null);
    setStatus(response?.status === 202 ? "sent" : "error");
  }

  if (status === "sent") {
    return <SuccessNote role="status">{t("login.sent")}</SuccessNote>;
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <Field label={t("login.email")}>
        <TextInput id="email" name="email" type="email" autoComplete="email" required />
      </Field>
      <Button type="submit" disabled={status === "sending"}>
        {t("login.submit")}
      </Button>
      {status === "error" && <ErrorAlert message={t("login.error")} />}
    </form>
  );
}
