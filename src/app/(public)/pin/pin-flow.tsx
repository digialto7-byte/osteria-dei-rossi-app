"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { forgetUser } from "@/components/forget-user";
import { Card, ErrorAlert, Heading, linkClass, Muted, SuccessNote } from "@/components/ui";
import { apiJson, detailList } from "@/lib/api/client";
import { t } from "@/lib/i18n";
import { landingFor } from "@/lib/nav/nav-model";
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

/** POST /api/auth/pin (src/server/staff-auth/pin-login.ts); only the role is read here. */
interface PinLoginReply {
  user: { role: "chef" | "waiter" };
}

type Load = { kind: "loading" } | DeviceScreen;

/**
 * The PIN screen: reads /api/auth/device, then posts to /api/auth/pin. No rule of its own.
 * Inside /login (M25a) `onNotEnrolled` hands over to the owner's form, and `showEnabled` names the phone just enabled.
 */
export function PinFlow({
  onNotEnrolled,
  showEnabled = false,
}: {
  onNotEnrolled?: (info: { revoked: boolean }) => void;
  showEnabled?: boolean;
}) {
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

  const revoked = load.kind === "not_enrolled" && load.revoked === true;
  useEffect(() => {
    if (load.kind === "not_enrolled") onNotEnrolled?.({ revoked });
  }, [load.kind, revoked, onNotEnrolled]);

  async function submit() {
    if (!person) return;
    setBusy(true);
    const result = await apiJson<PinLoginReply>("/api/auth/pin", {
      method: "POST",
      body: { userId: person.id, pin },
    });
    setBusy(false);
    setPin("");
    if (result.ok) {
      // A shared device must not keep the previous person's role; then each role lands where it works.
      forgetUser();
      router.replace(landingFor(result.data.user.role));
      return;
    }
    const feedback = loginFeedback({
      code: result.error.code,
      details: detailList(result.error.details),
    });
    setMessage(feedback.message);
    if (feedback.kind === "not_enrolled") {
      setLoad(
        result.error.code === "device_revoked"
          ? { kind: "not_enrolled", revoked: true }
          : { kind: "not_enrolled" },
      );
    }
    if (feedback.kind === "locked") setLoad({ kind: "locked" });
    if (feedback.kind === "user_locked") setPerson(null);
  }

  if (load.kind === "loading") return <Muted>{t("pin.loading")}</Muted>;

  if (load.kind === "not_enrolled" && onNotEnrolled) return null;

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
      {showEnabled && (
        <SuccessNote role="status">{t("login.enabled", { label: load.label })}</SuccessNote>
      )}
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
