"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, type ReactNode } from "react";
import { MeProblem } from "@/components/me-problem";
import { LogoutButton } from "@/components/logout-button";
import { useMe } from "@/components/use-me";
import { DashboardTiles } from "@/components/dashboard/dashboard-tiles";
import { useDashboard } from "@/components/use-dashboard";
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
 * to do (one primary action), and for the owner and admin a first-steps list and the dashboard tiles. The user and the
 * venue come from the one cached /api/me read; the choice and order of the links is src/lib/nav/today-actions.ts.
 * The owner and the admin read ONE request, GET /api/dashboard (counts, first steps and tiles from one snapshot); the
 * chef reads GET /api/today. If the read fails the actions stay and one notice says so.
 */
export default function HomePage() {
  const router = useRouter();
  const { status, me, retry } = useMe();
  const role = me?.user.role ?? null;
  const landing = role ? landingFor(role) : "/";
  const manager = role === "owner" || role === "admin";
  const today = useToday(role === "chef");
  const dashboard = useDashboard(manager);
  const counts = manager ? dashboard.data?.today : today.data;

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
  const cards = counts?.cards ?? [];
  const steps = stepStatuses(me.user.role, counts?.setup ?? null);
  const stepsHidden = allStepsDone(steps);

  // The dashboard is wide on a laptop; the to-do block above it keeps the phone column's width.
  const Wrapper = manager ? WideLayout : Fragment;
  return (
    <Wrapper>
      <Heading>{t("home.greeting", { name: me.user.displayName })}</Heading>
      <section aria-label={me.tenant.name}>
        <Card className="flex flex-col gap-0.5">
          <p className="font-display text-[1.5rem] leading-tight font-semibold">{me.tenant.name}</p>
          <p data-testid="role" className="text-ink-muted">
            {t("home.role", { role: t(`role.${me.user.role}`) })}
          </p>
        </Card>
      </section>
      {(manager ? dashboard : today).status === "error" && (
        <div className="flex flex-col gap-2">
          <ErrorAlert message={t(manager ? "dashboard.error" : "today.error")} />
          <div>
            <Button variant="secondary" onClick={(manager ? dashboard : today).retry}>
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
      {manager && dashboard.status === "loading" && <Muted>{t("dashboard.loading")}</Muted>}
      {manager && dashboard.data && (
        <section data-dashboard className="flex flex-col gap-3">
          <SubHeading>{t("dashboard.title")}</SubHeading>
          <DashboardTiles data={dashboard.data} />
        </section>
      )}
      <LogoutButton className="lg:hidden" />
    </Wrapper>
  );
}

/** `data-layout="wide"` widens `main` on a laptop (PageMain); the children keep the page's vertical rhythm. */
function WideLayout({ children }: { children: ReactNode }) {
  return (
    <div data-layout="wide" className="flex flex-col gap-6 lg:[&>:not([data-dashboard])]:max-w-md">
      {children}
    </div>
  );
}
