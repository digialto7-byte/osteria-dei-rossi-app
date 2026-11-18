"use client";

import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";
import { SessionExpiredNote } from "@/components/session-expired-note";
import { useHydrated } from "@/components/use-hydrated";
import { Button, Card, ErrorAlert, Field, Heading, TextInput } from "@/components/ui";
import { apiJson } from "@/lib/api/client";
import { safeNextPath } from "@/lib/api/safe-next";
import { passwordFieldType, toggleLabelKey, type LoginNotice } from "@/lib/auth/login-view";
import { isConsoleDown, resetConsoleSwitch } from "@/lib/console/console-api";
import { t } from "@/lib/i18n";
import { navigateTo } from "@/lib/nav/full-load";

const SIGN_IN_PATH = "/api/platform/auth/password";

/**
 * The console sign-in: e-mail and password to POST /api/platform/auth/password, which takes no `next`. The reply's redirect is the code page
 * or the enrolment page; the latter is a full document load (its CSP allows the QR image, chosen once per document). Both fields are
 * uncontrolled and read from the form at send time: they are never kept in state, storage or the address, and the password is cleared after an error.
 */
export function ConsoleSignIn({ notice }: { notice: LoginNotice | null }) {
  const router = useRouter();
  const hydrated = useHydrated();
  const passwordId = useId();
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy(true);
    setError(null);
    const result = await apiJson<{ redirect: string }>(SIGN_IN_PATH, {
      method: "POST",
      body: {
        email: String(data.get("email") ?? ""),
        password: String(data.get("password") ?? ""),
      },
    });
    setBusy(false);
    if (result.ok) {
      // A new sign-in may switch into console mode once more.
      resetConsoleSwitch();
      navigateTo(router, safeNextPath(result.data.redirect));
      return;
    }
    const password = form.elements.namedItem("password");
    if (password instanceof HTMLInputElement) password.value = "";
    if (result.error.code === "not_console_account") setError(t("console.noAccess"));
    else if (isConsoleDown({ ...result, leaving: false })) setError(t("console.unavailable"));
    else setError(result.error.message);
  }

  return (
    <Card edge className="mt-4 flex flex-col gap-5 px-5 pt-7 pb-6">
      <Heading>{t("console.signIn.title")}</Heading>
      <p className="text-ink">{t("console.signIn.intro")}</p>
      {notice === "session" && <SessionExpiredNote />}
      <form
        method="post"
        data-hydrated={hydrated ? "true" : undefined}
        onSubmit={signIn}
        className="flex flex-col gap-4"
      >
        <Field label={t("login.email")}>
          <TextInput id="email" name="email" type="email" autoComplete="username" required />
        </Field>
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
    </Card>
  );
}
