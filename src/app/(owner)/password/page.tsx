"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { BackLink } from "@/components/back-link";
import { NavLink } from "@/components/nav/nav-link";
import { usePasswordStatus } from "@/components/use-password-status";
import { ErrorAlert, Heading, Muted, linkClass } from "@/components/ui";
import { afterPasswordPath } from "@/lib/auth/password-view";
import { t } from "@/lib/i18n";
import { navigateTo } from "@/lib/nav/full-load";
import { PasswordForm } from "./password-form";

function PasswordScreen() {
  const router = useRouter();
  const dopo = afterPasswordPath(useSearchParams().get("dopo"));
  const state = usePasswordStatus(true);

  return (
    <>
      <BackLink href="/">{t("nav.today")}</BackLink>
      <Heading>{t("password.title")}</Heading>
      {state.status === "loading" && <Muted>{t("common.loading")}</Muted>}
      {state.status === "forbidden" && <ErrorAlert message={t("password.forbidden")} />}
      {state.status === "error" && <ErrorAlert message={state.message} />}
      {state.status === "ok" && (
        <PasswordForm
          status={state.data}
          afterSave={dopo}
          onSaved={() => {
            if (dopo) navigateTo(router, dopo);
          }}
          skip={
            dopo ? (
              <NavLink href={dopo} className={`${linkClass} self-start`}>
                {t("password.skip")}
              </NavLink>
            ) : null
          }
        />
      )}
    </>
  );
}

/** Set, reset or change the password of the signed-in owner or admin (GET and POST /api/me/password). */
export default function PasswordPage() {
  return (
    <Suspense fallback={<Muted>{t("common.loading")}</Muted>}>
      <PasswordScreen />
    </Suspense>
  );
}
