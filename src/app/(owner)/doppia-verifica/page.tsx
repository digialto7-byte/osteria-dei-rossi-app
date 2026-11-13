"use client";

import { MeProblem } from "@/components/me-problem";
import { useMe } from "@/components/use-me";
import { Heading, Muted } from "@/components/ui";
import { canManageMfa } from "@/lib/auth/mfa-access";
import { t } from "@/lib/i18n";
import { FactorList } from "./factor-list";

/**
 * "Verifica in due passaggi" (P2-1 B5): the owner and the admin manage their own authenticator factors and see the other privileged accounts' device counts.
 * The chef and the waiter never reach it (the gate hides it and the API answers 403). No reset lives here (Q-T1 = V1); the page points to DigiAlto for that.
 */
export default function MfaPage() {
  const { status, me, retry } = useMe();
  return (
    <>
      <Heading>{t("mfa.page.title")}</Heading>
      {status === "loading" && <Muted>{t("common.loading")}</Muted>}
      {me === null && status !== "loading" && <MeProblem status={status} retry={retry} />}
      {me !== null &&
        (canManageMfa(me.user.role) ? (
          <>
            <Muted>{t("mfa.page.intro")}</Muted>
            <FactorList />
          </>
        ) : (
          <MeProblem status="noAccess" retry={retry} />
        ))}
    </>
  );
}
