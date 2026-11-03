"use client";

import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";
import { forgetUser } from "@/components/forget-user";
import { Button, ErrorAlert, Field, Muted, SuccessNote, TextInput } from "@/components/ui";
import { apiJson } from "@/lib/api/client";
import { needsEmail, passwordFieldType, toggleLabelKey } from "@/lib/auth/login-view";
import { t } from "@/lib/i18n";
import { CodeForm } from "./code-form";

type Stage = "password" | "code";

/**
 * Owner and admin sign-in: e-mail and password first (POST /api/auth/password); the e-mail link, which also
 * carries a 6-digit code, is the fallback under "Password dimenticata o non ancora impostata?". No rule here:
 * the API decides, the redirect comes from its reply.
 */
export function PasswordForm({ next }: { next: string | undefined }) {
  const router = useRouter();
  const passwordId = useId();
  const [stage, setStage] = useState<Stage>("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const result = await apiJson<{ redirect: string }>("/api/auth/password", {
      method: "POST",
      body: { email, password, next },
    });
    setBusy(false);
    if (result.ok) {
      // A shared phone must not keep the previous person's role.
      forgetUser();
      router.replace(result.data.redirect);
      return;
    }
    setPassword("");
    setError(result.error.message);
  }

  async function sendLink() {
    if (needsEmail(email)) {
      setError(t("login.needEmail"));
      return;
    }
    setBusy(true);
    setError(null);
    const result = await apiJson("/api/auth/magic-link", { method: "POST", body: { email, next } });
    setBusy(false);
    if (result.ok) setStage("code");
    else setError(result.status === 429 ? result.error.message : t("login.error"));
  }

  const emailField = (
    <Field label={t("login.email")}>
      <TextInput
        id="email"
        name="email"
        type="email"
        autoComplete="username"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        required
      />
    </Field>
  );

  if (stage === "code") {
    return (
      <div className="flex flex-col gap-4">
        {emailField}
        <SuccessNote role="status">{t("login.sent")}</SuccessNote>
        <CodeForm
          email={email}
          next={next}
          onBack={() => {
            setStage("password");
            setError(null);
          }}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <form method="post" onSubmit={signIn} className="flex flex-col gap-4">
        {emailField}
        <div className="flex flex-col gap-1.5">
          <label htmlFor={passwordId} className="text-[0.9375rem] font-bold text-ink">
            {t("login.password")}
          </label>
          <div className="flex gap-2">
            <TextInput
              id={passwordId}
              name="password"
              type={passwordFieldType(shown)}
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
            <Button
              variant="quiet"
              aria-pressed={shown}
              aria-controls={passwordId}
              onClick={() => setShown((value) => !value)}
            >
              {t(toggleLabelKey(shown))}
            </Button>
          </div>
        </div>
        <ErrorAlert message={error} />
        <Button type="submit" disabled={busy}>
          {t("login.passwordSubmit")}
        </Button>
      </form>
      <div className="flex flex-col gap-2">
        <Muted>{t("login.forgot")}</Muted>
        <Button variant="secondary" disabled={busy} onClick={sendLink}>
          {t("login.submit")}
        </Button>
      </div>
    </div>
  );
}
