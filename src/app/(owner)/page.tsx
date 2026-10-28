"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { MeProblem } from "@/components/me-problem";
import { LogoutButton } from "@/components/logout-button";
import { useMe } from "@/components/use-me";
import {
  Card,
  Heading,
  LedgerList,
  LedgerRow,
  Muted,
  SubHeading,
  primaryLinkClass,
} from "@/components/ui";
import { t } from "@/lib/i18n";
import { landingFor } from "@/lib/nav/nav-model";
import { firstSteps, todayActions } from "@/lib/nav/today-actions";

const ROW_LINK =
  "flex min-h-tap items-center justify-between gap-3 py-2.5 transition-colors hover:bg-sunk";

/**
 * "Oggi": the home page of every role but the waiter, who goes straight to the tables. A short list of what
 * to do (one primary action), and for the owner and admin a first-steps list. The user and the venue come
 * from the one cached /api/me read; the choice and order of the links is src/lib/nav/today-actions.ts.
 */
export default function HomePage() {
  const router = useRouter();
  const { status, me, retry } = useMe();
  const role = me?.user.role ?? null;
  const landing = role ? landingFor(role) : "/";

  useEffect(() => {
    if (landing !== "/") router.replace(landing);
  }, [landing, router]);

  if (status === "loading") return <Muted>{t("home.loading")}</Muted>;
  if (me === null) {
    return (
      <>
        {status !== "signedOut" && <Heading>{t("app.name")}</Heading>}
        <MeProblem status={status} retry={retry} />
      </>
    );
  }
  if (landing !== "/") return null;

  const [primary, ...others] = todayActions(me.user.role);
  const steps = firstSteps(me.user.role);

  return (
    <>
      <Heading>{t("home.greeting", { name: me.user.displayName })}</Heading>
      <section aria-label={me.tenant.name}>
        <Card className="flex flex-col gap-0.5">
          <p className="font-display text-[1.5rem] leading-tight font-semibold">{me.tenant.name}</p>
          <p data-testid="role" className="text-ink-muted">
            {t("home.role", { role: t(`role.${me.user.role}`) })}
          </p>
        </Card>
      </section>
      <section className="flex flex-col gap-3">
        {primary && (
          <>
            <Link href={primary.href} className={`${primaryLinkClass} w-full`}>
              {t(primary.labelKey)}
            </Link>
            <Muted>{t(primary.hintKey)}</Muted>
          </>
        )}
        {others.length > 0 && (
          <LedgerList>
            {others.map((action) => (
              <LedgerRow key={action.href}>
                <Link href={action.href} className={ROW_LINK}>
                  <span className="flex flex-col">
                    <span className="font-bold">{t(action.labelKey)}</span>
                    <span className="text-ink-muted">{t(action.hintKey)}</span>
                  </span>
                  <span aria-hidden="true">→</span>
                </Link>
              </LedgerRow>
            ))}
          </LedgerList>
        )}
      </section>
      {steps.length > 0 && (
        <section className="flex flex-col gap-3">
          <SubHeading>{t("today.firstSteps")}</SubHeading>
          <LedgerList>
            {steps.map((step) => (
              <LedgerRow key={step.href}>
                <Link href={step.href} className={ROW_LINK}>
                  <span>{t(step.labelKey)}</span>
                  <span aria-hidden="true">→</span>
                </Link>
              </LedgerRow>
            ))}
          </LedgerList>
        </section>
      )}
      <LogoutButton className="lg:hidden" />
    </>
  );
}
