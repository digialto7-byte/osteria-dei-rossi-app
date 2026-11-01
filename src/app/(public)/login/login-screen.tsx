"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { Button, Card, ErrorAlert, linkClass, Muted, SubHeading } from "@/components/ui";
import type { LoginNotice } from "@/lib/auth/login-view";
import { t } from "@/lib/i18n";
import { PinFlow } from "../pin/pin-flow";
import { PasswordForm } from "./password-form";

/**
 * The one entry point. An enrolled device (device cookie present) opens on the staff PIN screen with the owner's
 * form one tap away; every other visitor, and a device the server no longer knows, sees the password form.
 * It works only from API replies and the query values the page passes in.
 */
export function LoginScreen({
  next,
  notice,
  hasDevice,
  justEnabled,
}: {
  next: string | undefined;
  notice: LoginNotice | null;
  hasDevice: boolean;
  justEnabled: boolean;
}) {
  const [staffView, setStaffView] = useState(hasDevice);
  const [ownerOpen, setOwnerOpen] = useState(false);
  const leaveStaffView = useCallback(() => setStaffView(false), []);

  if (staffView) {
    return (
      <div className="flex flex-col gap-5">
        <PinFlow onNotEnrolled={leaveStaffView} showEnabled={justEnabled} />
        <Button
          variant="quiet"
          aria-expanded={ownerOpen}
          aria-controls="owner-login"
          onClick={() => setOwnerOpen((open) => !open)}
        >
          {t("login.ownerToggle")}
        </Button>
        {ownerOpen && (
          <div id="owner-login" className="flex flex-col gap-4">
            <SubHeading>{t("login.ownerTitle")}</SubHeading>
            <PasswordForm next={next} />
          </div>
        )}
      </div>
    );
  }

  return (
    <Card className="relative mt-4 overflow-hidden px-5 pt-7 pb-6">
      {/* A gold rule across the top of the card, like the edge of the printed menu. */}
      <span aria-hidden="true" className="absolute inset-x-0 top-0 h-1 bg-gold" />
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-3">
          <h1 className="font-display text-[2.5rem] leading-none font-semibold tracking-[-0.01em] text-ink after:mt-4 after:block after:h-0.5 after:w-12 after:bg-gold">
            {t("login.title")}
          </h1>
          <p className="text-ink-muted">{t("login.intro")}</p>
        </div>
        {notice === "link" && <ErrorAlert message={t("login.linkError")} />}
        {notice === "session" && <Muted>{t("login.sessionExpired")}</Muted>}
        <PasswordForm next={next} />
        {/* A new staff phone has no way to /dispositivo otherwise: the proxy sends it here. */}
        <Link href="/dispositivo" className={`${linkClass} self-start`}>
          {t("login.enrolLink")}
        </Link>
      </div>
    </Card>
  );
}
