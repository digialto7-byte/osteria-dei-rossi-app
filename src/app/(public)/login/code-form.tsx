"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { forgetUser } from "@/components/forget-user";
import { Button, ErrorAlert, Field, TextInput } from "@/components/ui";
import { apiJson } from "@/lib/api/client";
import { codeDigits } from "@/lib/auth/login-view";
import { t } from "@/lib/i18n";

/** The 6-digit code of the sign-in e-mail, typed into the app itself (POST /api/auth/email-code). */
export function CodeForm({
  email,
  next,
  onBack,
}: {
  email: string;
  next: string | undefined;
  onBack: () => void;
}) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const result = await apiJson<{ redirect: string }>("/api/auth/email-code", {
      method: "POST",
      body: { email, code, next },
    });
    setBusy(false);
    if (result.ok) {
      forgetUser();
      router.replace(result.data.redirect);
      return;
    }
    setError(result.error.message);
  }

  return (
    <form method="post" onSubmit={submit} className="flex flex-col gap-4">
      <Field label={t("login.code")}>
        <TextInput
          id="code"
          name="code"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          pattern="[0-9]{6}"
          value={code}
          onChange={(event) => setCode(codeDigits(event.target.value))}
          required
        />
      </Field>
      <ErrorAlert message={error} />
      <Button type="submit" disabled={busy}>
        {t("login.codeSubmit")}
      </Button>
      <Button variant="quiet" onClick={onBack}>
        {t("login.backToPassword")}
      </Button>
    </form>
  );
}
