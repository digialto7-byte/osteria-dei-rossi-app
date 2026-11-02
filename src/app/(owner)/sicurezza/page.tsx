"use client";

import { MeProblem } from "@/components/me-problem";
import { useMe } from "@/components/use-me";
import { ErrorAlert, Heading, Muted } from "@/components/ui";
import { t } from "@/lib/i18n";
import { canSeeSafety } from "@/lib/safety/safety-view";

/**
 * "Sicurezza" (M25b, Q216): an empty "in arrivo" page, the entry of the future food-safety (HACCP) register (M31). It reads nothing
 * and promises no sensor or date. Owner and admin see the text; the chef and the waiter see the reserved notice.
 */
export default function SafetyPage() {
  const { status, me, retry } = useMe();
  return (
    <>
      <Heading>{t("safety.title")}</Heading>
      {status === "loading" && <Muted>{t("home.loading")}</Muted>}
      {me === null && status !== "loading" && <MeProblem status={status} retry={retry} />}
      {me !== null &&
        (canSeeSafety(me.user.role) ? (
          <Muted>{t("safety.soon")}</Muted>
        ) : (
          <ErrorAlert message={t("safety.forbidden")} />
        ))}
    </>
  );
}
