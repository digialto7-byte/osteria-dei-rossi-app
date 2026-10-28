"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { MeProblem } from "@/components/me-problem";
import { LogoutButton } from "@/components/logout-button";
import { useMe } from "@/components/use-me";
import { useToday } from "@/components/use-today";
import {
  Badge,
  Button,
  Card,
  ErrorAlert,
  Heading,
  LedgerList,
  LedgerRow,
  Muted,
  SubHeading,
  primaryLinkClass,
} from "@/components/ui";
import { t } from "@/lib/i18n";
import { landingFor } from "@/lib/nav/nav-model";
import {
  allStepsDone,
  badgeFor,
  stepStatuses,
  todayActions,
  type TodayAction,
} from "@/lib/nav/today-actions";
import type { TodayCard } from "@/server/today/types";

const ROW_LINK =
  "flex min-h-tap items-center justify-between gap-3 py-2.5 transition-colors hover:bg-sunk";

/** The state of one action from /api/today: a word with the count, or "Niente da fare". Nothing without a payload. */
function ActionBadge({ action, cards }: { action: TodayAction; cards: readonly TodayCard[] }) {
  const badge = badgeFor(action, cards);
  if (!badge) return null;
  return <Badge tone={badge.tone}>{t(badge.labelKey, { count: badge.count ?? 0 })}</Badge>;
}

/**
 * "Oggi": the home page of every role but the waiter, who goes straight to the tables. A short list of what
 * to do (one primary action), and for the owner and admin a first-steps list. The user and the venue come
 * from the one cached /api/me read; the choice and order of the links is src/lib/nav/today-actions.ts. The counts
 * and the state of the first steps come from GET /api/today; if that fails the actions stay and one notice says so.
 */
export default function HomePage() {
  const router = useRouter();
  const { status, me, retry } = useMe();
  const role = me?.user.role ?? null;
  const landing = role ? landingFor(role) : "/";
  const today = useToday(role !== null && landing === "/");

  useEffect(() => {
    if (landing !== "/") router.replace(landing);
  }, [landing, router]);

  if (status === "loading") {
    return (
      <>
        <Heading>{t("app.name")}</Heading>
        <Muted>{t("home.loading")}</Muted>
      </>
    );
  }
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
  const cards = today.data?.cards ?? [];
  const steps = stepStatuses(me.user.role, today.data?.setup ?? null);
  const stepsHidden = allStepsDone(steps);

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
      {today.status === "error" && (
        <div className="flex flex-col gap-2">
          <ErrorAlert message={t("today.error")} />
          <div>
            <Button variant="secondary" onClick={today.retry}>
              {t("common.retry")}
            </Button>
          </div>
        </div>
      )}
      <section className="flex flex-col gap-3">
        {primary && (
          <>
            <Link href={primary.href} className={`${primaryLinkClass} w-full`}>
              {t(primary.labelKey)}
            </Link>
            <Muted>{t(primary.hintKey)}</Muted>
            <ActionBadge action={primary} cards={cards} />
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
                    <ActionBadge action={action} cards={cards} />
                  </span>
                  <span aria-hidden="true">→</span>
                </Link>
              </LedgerRow>
            ))}
          </LedgerList>
        )}
      </section>
      {steps.length > 0 && !stepsHidden && (
        <section className="flex flex-col gap-3">
          <SubHeading>{t("today.firstSteps")}</SubHeading>
          <LedgerList>
            {steps.map((step) => (
              <LedgerRow key={step.href}>
                <Link href={step.href} className={ROW_LINK}>
                  <span>{t(step.labelKey)}</span>
                  <span className="flex items-center gap-2">
                    {step.done !== null && (
                      <Badge tone={step.done ? "success" : "neutral"}>
                        {t(step.done ? "today.step.done" : "today.step.todo")}
                      </Badge>
                    )}
                    <span aria-hidden="true">→</span>
                  </span>
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
