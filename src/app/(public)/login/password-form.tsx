"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, useState, type FormEvent } from "react";
import { forgetUser } from "@/components/forget-user";
import { useHydrated } from "@/components/use-hydrated";
import { Button, ErrorAlert, Field, Muted, SuccessNote, TextInput } from "@/components/ui";
import { navigateTo } from "@/lib/nav/full-load";
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
  const hydrated = useHydrated();
  const passwordId = useId();
  const [stage, setStage] = useState<Stage>("password");
  // The e-mail and password are uncontrolled: what a user or a password manager put in before React hydrated the page
  // stays in the DOM and is what gets sent, so it is read from the form at send time. `email` only mirrors the field
  // to carry it between the two stages.
  const formRef = useRef<HTMLFormElement>(null);
  const [email, setEmail] = useState("");
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy(true);
    setError(null);
    const result = await apiJson<{ redirect: string }>("/api/auth/password", {
      method: "POST",
      body: {
        email: String(data.get("email") ?? ""),
        password: String(data.get("password") ?? ""),
        next,
      },
    });
    setBusy(false);
    if (result.ok) {
      // A shared phone must not keep the previous person's role.
      forgetUser();
      navigateTo(router, result.data.redirect);
      return;
    }
    form.querySelector<HTMLInputElement>('[name="password"]')!.value = "";
    setError(result.error.message);
  }

  async function sendLink() {
    const typed = String(new FormData(formRef.current!).get("email") ?? "");
    setEmail(typed);
    if (needsEmail(typed)) {
      setError(t("login.needEmail"));
      return;
    }
    setBusy(true);
    setError(null);
    const result = await apiJson("/api/auth/magic-link", {
      method: "POST",
      body: { email: typed, next },
    });
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
        defaultValue={email}
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
      <form
        ref={formRef}
        method="post"
        data-hydrated={hydrated ? "true" : undefined}
        onSubmit={signIn}
        className="flex flex-col gap-4"
      >
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
        <Button type="submit" disabled={busy || !hydrated}>
          {t("login.passwordSubmit")}
        </Button>
      </form>
      <div className="flex flex-col gap-2">
        <Muted>{t("login.forgot")}</Muted>
        <Button variant="secondary" disabled={busy || !hydrated} onClick={sendLink}>
          {t("login.submit")}
        </Button>
      </div>
    </div>
  );
}
