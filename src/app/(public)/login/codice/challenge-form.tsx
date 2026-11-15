"use client";

import { useRouter } from "next/navigation";
import { useEffect, useEffectEvent, useId, useRef, useState, type FormEvent } from "react";
import { forgetUser } from "@/components/forget-user";
import { LogoutButton } from "@/components/logout-button";
import { LiveError } from "@/components/mfa/live-error";
import { Button, Muted, TextInput } from "@/components/ui";
import { apiJson } from "@/lib/api/client";
import { navigateTo } from "@/lib/nav/full-load";
import { safeNextPath } from "@/lib/api/safe-next";
import { codeDigits } from "@/lib/auth/login-view";
import {
  accountGate,
  accountVerifiedFactors,
  usesAccountFallback,
  type AccountMfaStatus,
} from "@/lib/console/account-mfa";
import {
  factorToUse,
  lockedMinutes,
  mfaErrorMessage,
  retryAfterSeconds,
  verifiedFactors,
} from "@/lib/auth/mfa-view";
import { t, tn } from "@/lib/i18n";
import type { MfaStatus } from "@/server/auth/mfa-schemas";

const CODE_LENGTH = 6;
const MS_PER_SECOND = 1000;
const ENROL_PAGE = "/login/attiva-codice";
const TENANT_STATUS = "/api/me/mfa";
const TENANT_CHALLENGE = "/api/auth/mfa/challenge";
const ACCOUNT_PATH = "/api/auth/mfa/account";

// The verified factors, main device first, and the route that takes the code: the venue's pair, or the account pair (L11).
type Load =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "form"; verified: { id: string }[]; challengePath: string };

/**
 * The code step of a sign-in (P2-1, plan section 3.13). Reads GET /api/me/mfa for the factors and the lock, posts the code once to
 * POST /api/auth/mfa/challenge and follows the redirect in the reply. A platform account opened on the venue host (403 no_tenant or 409
 * tenant_selection_required) is read and answered through /api/auth/mfa/account instead. The code is only in the field's state: never stored, never in a URL.
 */
export function ChallengeForm({ next }: { next: string | undefined }) {
  const router = useRouter();
  const inputId = useId();
  const codeRef = useRef<HTMLInputElement>(null);
  const safeNext = safeNextPath(next);
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [code, setCode] = useState("");
  const [useBackup, setUseBackup] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lockedUntil, setLockedUntil] = useState<string | null>(null);

  const goTo = useEffectEvent((path: string) => navigateTo(router, path));
  useEffect(() => {
    let live = true;
    void (async () => {
      const result = await apiJson<MfaStatus>(TENANT_STATUS);
      if (!live) return;
      if (!result.ok) {
        // A platform account on the venue host has no venue: only these two replies mean "read the account's factors instead".
        if (!usesAccountFallback(result)) {
          setLoad({ kind: "error", message: result.error.message });
          return;
        }
        const account = await apiJson<AccountMfaStatus>(ACCOUNT_PATH);
        if (!live) return;
        if (!account.ok) {
          setLoad({ kind: "error", message: account.error.message });
          return;
        }
        const gate = accountGate(account.data);
        if (gate === "ok") goTo(safeNext);
        // The enrolment page of the venue app works on the venue's routes; the account enrols from the console.
        else if (gate === "enrol") setLoad({ kind: "error", message: t("mfa.account.noFactor") });
        else {
          setLockedUntil(account.data.lockedUntil);
          setLoad({
            kind: "form",
            verified: accountVerifiedFactors(account.data.factors),
            challengePath: ACCOUNT_PATH,
          });
        }
        return;
      }
      const status = result.data;
      // Nothing to ask: the session is already complete, or the account must enrol first.
      if (status.gate === "ok") goTo(safeNext);
      else if (status.gate === "enrol") goTo(`${ENROL_PAGE}?next=${encodeURIComponent(safeNext)}`);
      else {
        setLockedUntil(status.lockedUntil);
        setLoad({
          kind: "form",
          verified: verifiedFactors(status.factors),
          challengePath: TENANT_CHALLENGE,
        });
      }
    })();
    return () => {
      live = false;
    };
  }, [safeNext]);

  // The field opens again when the lock runs out.
  useEffect(() => {
    if (lockedUntil === null) return;
    const wait = Math.max(0, Date.parse(lockedUntil) - Date.now());
    const timer = setTimeout(() => setLockedUntil(null), wait);
    return () => clearTimeout(timer);
  }, [lockedUntil]);

  // The field takes the focus when the form shows and again when a lock ends (a disabled field cannot hold it meanwhile).
  const formReady = load.kind === "form";
  const unlocked = lockedUntil === null;
  useEffect(() => {
    if (formReady && unlocked) codeRef.current?.focus();
  }, [formReady, unlocked]);

  const escape = <LogoutButton />;
  if (load.kind === "loading") return <Muted>{t("common.loading")}</Muted>;
  if (load.kind === "error")
    return (
      <div className="flex flex-col gap-4">
        <LiveError message={load.message} />
        {escape}
      </div>
    );

  const { verified, challengePath } = load;
  const factor = factorToUse(verified, useBackup);
  const minutes = lockedMinutes(lockedUntil, new Date());
  const locked = minutes !== null;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!factor || code.length !== CODE_LENGTH || busy || locked) return;
    setBusy(true);
    setError(null);
    const result = await apiJson<{ redirect: string }>(challengePath, {
      method: "POST",
      body: { factorId: factor.id, code, next: safeNext },
    });
    setBusy(false);
    if (result.ok) {
      forgetUser();
      navigateTo(router, result.data.redirect);
      return;
    }
    setCode("");
    const seconds =
      result.error.code === "mfa_locked" ? retryAfterSeconds(result.error.details) : null;
    if (seconds !== null) {
      setLockedUntil(new Date(Date.now() + seconds * MS_PER_SECOND).toISOString());
      return;
    }
    setError(mfaErrorMessage(result.error));
    codeRef.current?.focus();
  }

  return (
    <div className="flex flex-col gap-5">
      <form onSubmit={submit} method="post" className="flex flex-col gap-4">
        <Muted>{t("mfa.challenge.intro")}</Muted>
        <label htmlFor={inputId} className="sr-only">
          {t("mfa.code.label")}
        </label>
        <TextInput
          id={inputId}
          ref={codeRef}
          name="code"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={CODE_LENGTH}
          pattern="[0-9]{6}"
          value={code}
          disabled={locked}
          onChange={(event) => setCode(codeDigits(event.target.value))}
          required
        />
        <LiveError message={locked ? tn("mfa.locked", minutes) : error} />
        <Button type="submit" disabled={busy || locked || code.length !== CODE_LENGTH}>
          {t("mfa.challenge.submit")}
        </Button>
        {verified.length > 1 && (
          <Button variant="quiet" onClick={() => setUseBackup((value) => !value)}>
            {t(useBackup ? "mfa.challenge.useMain" : "mfa.challenge.useBackup")}
          </Button>
        )}
      </form>
      {escape}
    </div>
  );
}
