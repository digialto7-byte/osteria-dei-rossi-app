"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, type ReactNode } from "react";
import { MeProblem } from "@/components/me-problem";
import { useMe } from "@/components/use-me";
import { DashboardTiles } from "@/components/dashboard/dashboard-tiles";
import { HomeAlertsView } from "@/components/home/home-alerts";
import { KitchenCard } from "@/components/home/kitchen-card";
import { useDashboard } from "@/components/use-dashboard";
import { useHomeAlerts } from "@/components/use-home-alerts";
import { useKitchenSummary } from "@/components/use-kitchen-summary";
import { usePendingRequests } from "@/components/use-pending-requests";
import { usePasswordStatus } from "@/components/use-password-status";
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
  linkClass,
  primaryLinkClass,
} from "@/components/ui";
import { passwordLinkKey } from "@/lib/auth/password-view";
import { t } from "@/lib/i18n";
import { landingFor } from "@/lib/nav/nav-model";
import {
  ALERTS_BADGE_ACTION,
  allStepsDone,
  badgeFor,
  requestsBadge,
  stepStatuses,
  todayActions,
  type TodayAction,
} from "@/lib/nav/today-actions";
import type { TodayCard } from "@/server/today/types";

const ROW_LINK =
  "flex min-h-tap items-center justify-between gap-3 py-2.5 transition-colors hover:bg-sunk";

/** The state of one action from /api/today: a word with the count, or "Niente da fare". Nothing without a payload. */
function ActionBadge({
  action,
  cards,
  requests,
}: {
  action: TodayAction;
  cards: readonly TodayCard[];
  /** The booking requests waiting (QW3), null while unknown. */
  requests: number | null;
}) {
  const badge = action.counts === "requests" ? requestsBadge(requests) : badgeFor(action, cards);
  if (!badge) return null;
  return <Badge tone={badge.tone}>{t(badge.labelKey, { count: badge.count ?? 0 })}</Badge>;
}

/**
 * "Home": the first page of every role but the waiter, who goes straight to the tables. Order (ADR-041, which replaced ADR-030 decision 4 for
 * owner and admin): the open alerts (owner and chef), a short list of what to do (one primary action), the dashboard tiles (owner and
 * admin), the first-steps list (owner and admin) and the account card. "Esci" is in the header band. The user and the venue come from the one cached /api/me read; the choice and order of the links is
 * src/lib/nav/today-actions.ts. The owner and the admin read ONE request, GET /api/dashboard (counts, first steps and tiles from one
 * snapshot); the chef reads GET /api/today; the owner and the chef also read the three newest open alerts. If a read fails the actions stay
 * and one notice says so.
 */
export default function HomePage() {
  const router = useRouter();
  const { status, me, retry } = useMe();
  const role = me?.user.role ?? null;
  const landing = role ? landingFor(role) : "/";
  const manager = role === "owner" || role === "admin";
  const today = useToday(role === "chef");
  const kitchen = useKitchenSummary(role === "chef");
  const dashboard = useDashboard(manager);
  const password = usePasswordStatus(manager);
  const requests = usePendingRequests(manager).pending;
  const counts = manager ? dashboard.data?.today : today.data;
  // The strip is for the roles /api/alerts answers (owner and chef; the admin gets a 403 there, so never asks).
  const refreshCounts = manager ? dashboard.retry : today.retry;
  const alerts = useHomeAlerts(role === "owner" || role === "chef", refreshCounts);

  useEffect(() => {
    if (landing !== "/") router.replace(landing);
  }, [landing, router]);

  if (status === "loading") {
    return (
      <>
        <Heading>{t("venue.name")}</Heading>
        <Muted>{t("home.loading")}</Muted>
      </>
    );
  }
  if (me === null) {
    return (
      <>
        {status !== "signedOut" && <Heading>{t("venue.name")}</Heading>}
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
      {(role === "owner" || role === "chef") && (
        <HomeAlertsView
          status={alerts.status}
          alerts={alerts.alerts}
          badge={badgeFor(ALERTS_BADGE_ACTION, cards)}
          busyId={alerts.busyId}
          error={alerts.error}
          onAcknowledge={(id) => void alerts.acknowledge(id)}
        />
      )}
      {kitchen.status !== "idle" && <KitchenCard state={kitchen} />}
      <section className="flex flex-col gap-3">
        {primary && (
          <>
            <Link href={primary.href} className={`${primaryLinkClass} w-full`}>
              {t(primary.labelKey)}
            </Link>
            <Muted>{t(primary.hintKey)}</Muted>
            <ActionBadge action={primary} cards={cards} requests={requests} />
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
                    <ActionBadge action={action} cards={cards} requests={requests} />
                  </span>
                  <span aria-hidden="true">→</span>
                </Link>
              </LedgerRow>
            ))}
          </LedgerList>
        )}
      </section>
      {manager && dashboard.status === "loading" && <Muted>{t("dashboard.loading")}</Muted>}
      {manager && dashboard.data && (
        <section data-dashboard className="flex flex-col gap-3">
          <SubHeading>{t("dashboard.title")}</SubHeading>
          <DashboardTiles data={dashboard.data} />
        </section>
      )}
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
      <section aria-label={me.tenant.name}>
        <Card className="flex flex-col gap-0.5">
          <p className="font-display text-[1.5rem] leading-tight font-semibold">{me.tenant.name}</p>
          <p data-testid="role" className="text-ink-muted">
            {t("home.role", { role: t(`role.${me.user.role}`) })}
          </p>
          {password.status === "ok" && (
            <Link href="/password" className={`${linkClass} self-start`}>
              {t(passwordLinkKey(password.data.signInMethod))}
            </Link>
          )}
        </Card>
      </section>
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
