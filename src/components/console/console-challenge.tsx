"use client";

import { useRouter } from "next/navigation";
import { useEffect, useEffectEvent, useId, useRef, useState, type FormEvent } from "react";
import { LiveError } from "@/components/mfa/live-error";
import { Button, Muted, TextInput } from "@/components/ui";
import { apiJson } from "@/lib/api/client";
import { safeNextPath } from "@/lib/api/safe-next";
import { codeDigits } from "@/lib/auth/login-view";
import {
  factorToUse,
  lockedMinutes,
  mfaErrorMessage,
  retryAfterSeconds,
} from "@/lib/auth/mfa-view";
import {
  accountGate,
  accountVerifiedFactors,
  type AccountFactor,
  type AccountMfaStatus,
} from "@/lib/console/account-mfa";
import { isConsoleDown } from "@/lib/console/console-api";
import { t, tn } from "@/lib/i18n";
import { navigateTo } from "@/lib/nav/full-load";
import { ConsoleLogout } from "./console-logout";

const CODE_LENGTH = 6;
const MS_PER_SECOND = 1000;
const ACCOUNT_PATH = "/api/auth/mfa/account";
const ENROL_PAGE = "/login/attiva-codice";

type Load =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "form"; verified: AccountFactor[] };

/**
 * The console's code step. It reads only the account pair (GET and POST /api/auth/mfa/account) and never /api/me/mfa. The code lives in the
 * field's state, never in storage or the address. A page reached through a 403 mfa_required carries `next` and says why the code is asked.
 */
export function ConsoleChallenge({ next }: { next: string | undefined }) {
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
      const result = await apiJson<AccountMfaStatus>(ACCOUNT_PATH);
      if (!live) return;
      if (!result.ok) {
        const down = isConsoleDown({ ...result, leaving: false });
        setLoad({
          kind: "error",
          message:
            result.error.code === "forbidden"
              ? t("console.noAccess")
              : down
                ? t("console.unavailable")
                : result.error.message,
        });
        return;
      }
      const gate = accountGate(result.data);
      if (gate === "ok") goTo(safeNext);
      // A full document load: the enrolment page's CSP (QR image) is chosen once per document.
      else if (gate === "enrol") goTo(`${ENROL_PAGE}?next=${encodeURIComponent(safeNext)}`);
      else {
        setLockedUntil(result.data.lockedUntil);
        setLoad({ kind: "form", verified: accountVerifiedFactors(result.data.factors) });
      }
    })();
    return () => {
      live = false;
    };
  }, [safeNext]);

  useEffect(() => {
    if (lockedUntil === null) return;
    const wait = Math.max(0, Date.parse(lockedUntil) - Date.now());
    const timer = setTimeout(() => setLockedUntil(null), wait);
    return () => clearTimeout(timer);
  }, [lockedUntil]);

  const formReady = load.kind === "form";
  const unlocked = lockedUntil === null;
  useEffect(() => {
    if (formReady && unlocked) codeRef.current?.focus();
  }, [formReady, unlocked]);

  const escape = <ConsoleLogout tone="plain" />;
  if (load.kind === "loading") return <Muted>{t("common.loading")}</Muted>;
  if (load.kind === "error")
    return (
      <div className="flex flex-col gap-4">
        <LiveError message={load.message} />
        {escape}
      </div>
    );

  const { verified } = load;
  const factor = factorToUse(verified, useBackup);
  const minutes = lockedMinutes(lockedUntil, new Date());
  const locked = minutes !== null;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!factor || code.length !== CODE_LENGTH || busy || locked) return;
    setBusy(true);
    setError(null);
    const result = await apiJson<{ redirect: string }>(ACCOUNT_PATH, {
      method: "POST",
      body: { factorId: factor.id, code, next: safeNext },
    });
    setBusy(false);
    if (result.ok) {
      navigateTo(router, safeNextPath(result.data.redirect));
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
      {next !== undefined && next !== "" && <p role="status">{t("console.code.continue")}</p>}
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
