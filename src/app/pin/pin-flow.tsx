"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Card, ErrorAlert, Heading, linkClass, Muted } from "@/components/ui";
import { apiJson, detailList } from "@/lib/api/client";
import { t } from "@/lib/i18n";
import {
  deviceScreen,
  loginFeedback,
  sanitizePin,
  type DeviceReply,
  type DeviceScreen,
  type StaffEntry,
} from "@/lib/staff-auth/pin-view";
import { PinPad } from "./pin-pad";
import { StaffPicker } from "./staff-picker";

type Load = { kind: "loading" } | DeviceScreen;

/** The PIN screen: reads /api/auth/device, then posts to /api/auth/pin. No rule of its own. */
export function PinFlow() {
  const router = useRouter();
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [person, setPerson] = useState<StaffEntry | null>(null);
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiJson<DeviceReply>("/api/auth/device").then((result) => {
      if (cancelled) return;
      if (result.ok) setLoad(deviceScreen(result.data));
      else setMessage(t("pin.unavailable"));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function submit() {
    if (!person) return;
    setBusy(true);
    const result = await apiJson("/api/auth/pin", {
      method: "POST",
      body: { userId: person.id, pin },
    });
    setBusy(false);
    setPin("");
    if (result.ok) {
      router.replace("/");
      return;
    }
    const feedback = loginFeedback({
      code: result.error.code,
      details: detailList(result.error.details),
    });
    setMessage(feedback.message);
    if (feedback.kind === "not_enrolled") setLoad({ kind: "not_enrolled" });
    if (feedback.kind === "locked") setLoad({ kind: "locked" });
    if (feedback.kind === "user_locked") setPerson(null);
  }

  if (load.kind === "loading") return <Muted>{t("pin.loading")}</Muted>;

  if (load.kind === "not_enrolled") {
    return (
      <Card className="flex flex-col gap-4">
        <Heading>{t("pin.notEnrolled")}</Heading>
        <Link href="/dispositivo" className={linkClass}>
          {t("pin.enrolLink")}
        </Link>
        <Link href="/login" className={linkClass}>
          {t("pin.emailLink")}
        </Link>
      </Card>
    );
  }

  if (load.kind === "locked") {
    return <ErrorAlert message={t("staffAuthError.device_locked")} />;
  }

  return (
    <div className="flex flex-col gap-5">
      {person ? (
        <PinPad
          name={person.displayName}
          pin={pin}
          busy={busy}
          message={message}
          onChange={(value) => setPin(sanitizePin(value))}
          onSubmit={submit}
          onBack={() => {
            setPerson(null);
            setPin("");
            setMessage(null);
          }}
        />
      ) : (
        <>
          <Heading>{t("pin.title")}</Heading>
          <ErrorAlert message={message} />
          <StaffPicker
            staff={load.staff}
            onPick={(next) => {
              setPerson(next);
              setPin("");
              setMessage(null);
            }}
          />
        </>
      )}
    </div>
  );
}
