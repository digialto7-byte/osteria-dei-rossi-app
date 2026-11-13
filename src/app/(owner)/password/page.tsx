"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { BackLink } from "@/components/back-link";
import { usePasswordStatus } from "@/components/use-password-status";
import { ErrorAlert, Heading, Muted, linkClass } from "@/components/ui";
import { afterPasswordPath } from "@/lib/auth/password-view";
import { t } from "@/lib/i18n";
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
            if (dopo) router.replace(dopo);
          }}
          skip={
            dopo ? (
              <Link href={dopo} className={`${linkClass} self-start`}>
                {t("password.skip")}
              </Link>
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
