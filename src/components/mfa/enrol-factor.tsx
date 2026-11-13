"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useHydrated } from "@/components/use-hydrated";
import { Button, Muted, SubHeading, TextInput } from "@/components/ui";
import { apiJson } from "@/lib/api/client";
import { codeDigits } from "@/lib/auth/login-view";
import type { MfaSlot } from "@/lib/auth/mfa-constants";
import { groupSecret, mfaErrorMessage } from "@/lib/auth/mfa-view";
import { t } from "@/lib/i18n";
import { LiveError } from "./live-error";

const CODE_LENGTH = 6;

type Enrolment = { factorId: string; qrImage: string; secret: string };

/** One slot: ask for the secret on mount, show it as a QR image and a key, check the first code. */
function EnrolStep({
  slot,
  onVerified,
  onCancel,
}: {
  slot: MfaSlot;
  onVerified: () => void;
  onCancel?: () => void;
}) {
  const hydrated = useHydrated();
  const codeId = useId();
  const keyId = useId();
  const codeRef = useRef<HTMLInputElement>(null);
  const started = useRef(false);
  const mounted = useRef(false);
  const [enrolment, setEnrolment] = useState<Enrolment | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Mounting starts the enrolment (the host decides when to mount: a button on the offer page and the list). The ref keeps strict mode from asking twice.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      const result = await apiJson<Enrolment>("/api/me/mfa/factors", {
        method: "POST",
        body: { slot },
      });
      if (!mounted.current) return;
      if (result.ok) setEnrolment(result.data);
      else setProblem(mfaErrorMessage(result.error));
    })();
  }, [slot, attempt]);

  function retry() {
    started.current = false;
    setProblem(null);
    setAttempt((n) => n + 1);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!enrolment || code.length !== CODE_LENGTH || busy) return;
    setBusy(true);
    setError(null);
    const result = await apiJson(`/api/me/mfa/factors/${enrolment.factorId}/verify`, {
      method: "POST",
      body: { code },
    });
    if (!mounted.current) return;
    setBusy(false);
    if (result.ok) {
      onVerified();
      return;
    }
    setError(mfaErrorMessage(result.error));
    setCode("");
    codeRef.current?.focus();
  }

  const cancel = onCancel && (
    <Button variant="quiet" onClick={onCancel}>
      {t("mfa.enrol.cancel")}
    </Button>
  );

  if (problem !== null) {
    return (
      <div className="flex flex-col gap-4">
        <LiveError message={problem} />
        <Button onClick={retry}>{t("mfa.enrol.retry")}</Button>
        {cancel}
      </div>
    );
  }
  if (enrolment === null) return <Muted>{t("mfa.enrol.preparing")}</Muted>;

  return (
    <form
      method="post"
      data-hydrated={hydrated ? "true" : undefined}
      onSubmit={submit}
      className="flex flex-col gap-5"
    >
      <ol className="flex list-decimal flex-col gap-5 pl-6 marker:font-bold marker:text-ink">
        <li>{t("mfa.enrol.step1")}</li>
        <li className="flex flex-col gap-3">
          <span>{t("mfa.enrol.step2")}</span>
          {/* The reply's qrImage is a clean data: URL the API re-encoded; it is only ever an image source, never markup. */}
          {/* eslint-disable-next-line @next/next/no-img-element -- a data: URL, nothing to optimise */}
          <img
            src={enrolment.qrImage}
            alt={t("mfa.qr.alt")}
            width={224}
            height={224}
            className="mx-auto h-56 w-56 max-w-full rounded-lg border border-rule-strong bg-white p-2"
          />
          <label htmlFor={keyId} className="text-sm text-ink-muted">
            {t("mfa.enrol.keyIntro")}
          </label>
          <TextInput
            id={keyId}
            aria-label={t("mfa.enrol.keyLabel")}
            readOnly
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="characters"
            spellCheck={false}
            value={groupSecret(enrolment.secret)}
            className="font-mono tracking-wider"
          />
        </li>
        <li className="flex flex-col gap-2">
          <label htmlFor={codeId}>{t("mfa.enrol.step3")}</label>
          <TextInput
            id={codeId}
            ref={codeRef}
            name="code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={CODE_LENGTH}
            pattern="[0-9]{6}"
            aria-label={t("mfa.code.label")}
            value={code}
            onChange={(event) => setCode(codeDigits(event.target.value))}
            required
          />
        </li>
      </ol>
      <LiveError message={error} />
      <Button type="submit" disabled={busy || !hydrated || code.length !== CODE_LENGTH}>
        {t("mfa.enrol.submit")}
      </Button>
      {cancel}
    </form>
  );
}

/**
 * Enrolment of an authenticator app (P2-1, section 3.13): installs, scans or types the key, confirms with a code. Every value comes from
 * POST /api/me/mfa/factors and its verify route; the secret stays in this component's state and is gone when it unmounts. With `offerBackup`
 * a first factor is followed by the offer of a backup device. `onFinished` is called once when the person is done (or says "later").
 */
export function EnrolFactor({
  slot,
  offerBackup,
  onFinished,
  onCancel,
}: {
  slot: MfaSlot;
  offerBackup: boolean;
  onFinished: () => void;
  onCancel?: () => void;
}) {
  const [current, setCurrent] = useState<MfaSlot>(slot);
  const [asking, setAsking] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (asking) headingRef.current?.focus();
  }, [asking]);

  if (asking) {
    return (
      <div className="flex flex-col gap-4">
        <SubHeading ref={headingRef} tabIndex={-1}>
          {t("mfa.backup.title")}
        </SubHeading>
        <Muted>{t("mfa.backup.text")}</Muted>
        <Button
          onClick={() => {
            setAsking(false);
            setCurrent("riserva");
          }}
        >
          {t("mfa.backup.add")}
        </Button>
        <Button variant="quiet" onClick={onFinished}>
          {t("mfa.backup.later")}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {current === "riserva" && <SubHeading>{t("mfa.enrol.titleBackup")}</SubHeading>}
      <EnrolStep
        key={current}
        slot={current}
        onCancel={onCancel}
        onVerified={() => {
          if (offerBackup && current === "principale") setAsking(true);
          else onFinished();
        }}
      />
    </div>
  );
}
