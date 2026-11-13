"use client";

import Link from "next/link";
import { useId, useState, type FormEvent, type ReactNode } from "react";
import { useHydrated } from "@/components/use-hydrated";
import { Button, ErrorAlert, Muted, SuccessNote, TextInput, linkClass } from "@/components/ui";
import { apiJson } from "@/lib/api/client";
import { passwordFieldType, toggleLabelKey } from "@/lib/auth/login-view";
import { passwordIntroKey } from "@/lib/auth/password-view";
import { t } from "@/lib/i18n";
import type { PasswordStatus } from "@/server/auth/schemas";

/** The reply of POST /api/me/password: whether the fresh session must still pass the second-factor code (P2-1). */
type SaveReply = { status: "saved"; mfa?: "challenge" | "none" };

/**
 * The form of /password. The API decides whether a current password is needed (`recentSignIn`) and what is refused.
 * When changing the password opened a new session that still owes the code (P2-1 B7), the reply says `mfa:"challenge"`
 * and the browser goes to /login/codice (a full load, so the proxy and the gate run); otherwise `onSaved` runs as before.
 */
export function PasswordForm({
  status: initialStatus,
  onSaved,
  skip,
  afterSave,
}: {
  status: PasswordStatus;
  onSaved: () => void;
  skip: ReactNode;
  /** The safe path to return to after the code (the page's `?dopo`), or null for the landing page. */
  afterSave?: string | null;
}) {
  const hydrated = useHydrated();
  const currentId = useId();
  const newId = useId();
  const hintId = useId();
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState(initialStatus);
  // The server can ask for the current password after the page was loaded (the recent sign-in lapsed).
  const [serverWantsCurrent, setServerWantsCurrent] = useState(false);
  const needsCurrent = serverWantsCurrent || !status.recentSignIn;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Uncontrolled fields: what was typed or autofilled before hydration is in the DOM, so it is read from the form.
    const data = new FormData(event.currentTarget);
    const next = String(data.get("newPassword") ?? "");
    const current = String(data.get("currentPassword") ?? "");
    setBusy(true);
    setError(null);
    const result = await apiJson<SaveReply>("/api/me/password", {
      method: "POST",
      body: { newPassword: next, ...(needsCurrent && current ? { currentPassword: current } : {}) },
    });
    if (result.ok) {
      if (result.data.mfa === "challenge") {
        const back = encodeURIComponent(afterSave ?? "/");
        // A full load, not the router: the proxy refreshes the session and the gate runs, so the code page sees the fresh aal1 session (like the client's MFA redirect).
        const location = window.location;
        location.assign(`/login/codice?next=${back}`);
        return;
      }
      setBusy(false);
      setSaved(true);
      onSaved();
      return;
    }
    setBusy(false);
    setError(result.error.message);
    if (result.error.code === "current_password_required") {
      setServerWantsCurrent(true);
      const fresh = await apiJson<PasswordStatus>("/api/me/password");
      if (fresh.ok) setStatus(fresh.data);
    }
  }

  if (saved) return <SuccessNote role="status">{t("password.saved")}</SuccessNote>;

  return (
    <form
      method="post"
      data-hydrated={hydrated ? "true" : undefined}
      onSubmit={submit}
      className="flex flex-col gap-4"
    >
      <Muted>
        {t(needsCurrent ? "password.introChange" : passwordIntroKey(status.signInMethod))}
      </Muted>
      {needsCurrent && (
        <div className="flex flex-col gap-1.5">
          <label htmlFor={currentId} className="text-[0.9375rem] font-bold text-ink">
            {t("password.current")}
          </label>
          <TextInput
            id={currentId}
            name="currentPassword"
            type="password"
            autoComplete="current-password"
            required
          />
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        <label htmlFor={newId} className="text-[0.9375rem] font-bold text-ink">
          {t("password.new")}
        </label>
        <div className="flex gap-2">
          <TextInput
            id={newId}
            name="newPassword"
            type={passwordFieldType(shown)}
            autoComplete="new-password"
            aria-describedby={hintId}
            required
          />
          <Button
            variant="quiet"
            aria-pressed={shown}
            aria-controls={newId}
            onClick={() => setShown((value) => !value)}
          >
            {t(toggleLabelKey(shown))}
          </Button>
        </div>
        <span id={hintId} className="text-sm leading-snug text-ink-muted">
          {t("password.hint", { count: status.minLength })}
        </span>
      </div>
      <ErrorAlert message={error} />
      <Button type="submit" disabled={busy || !hydrated}>
        {t("password.submit")}
      </Button>
      {skip}
      {needsCurrent && (
        <Link href="/login?next=%2Fpassword" className={`${linkClass} self-start`}>
          {t("password.noCurrent")}
        </Link>
      )}
    </form>
  );
}
