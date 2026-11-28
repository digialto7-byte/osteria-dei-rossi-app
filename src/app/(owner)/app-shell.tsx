"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { VENUE_LAYER_DEFAULT } from "@/lib/design/venue-layer";
import { HeaderBand } from "@/components/header-band";
import { LeaveGuardProvider } from "@/components/nav/leave-guard";
import { ShellBrandLink } from "@/components/nav/shell-brand-link";
import { AccountControl } from "@/components/nav/account-control";
import { BottomTabsView } from "@/components/nav/bottom-tabs";
import { SectionNavView } from "@/components/nav/section-nav";
import { SidebarNavView } from "@/components/nav/sidebar-nav";
import { PageMain } from "@/components/page-main";
import { useMe, type MeState } from "@/components/use-me";
import { useTenantSwitchListener } from "@/components/use-tenant-switch-listener";
import { SyncStatus } from "@/components/sync/sync-status";
import { t } from "@/lib/i18n";
import { useSyncBoot } from "@/pwa/use-outbox";
import { currentSection, currentTab, isFocusRoute, navFor, phoneTabs } from "@/lib/nav/nav-model";
import { DemoBanner } from "./demo-banner";

/**
 * The shell around every signed-in page, home included (ADR-020): tab bar and section row on the phone,
 * sidebar on the laptop, the one `main`. The navigation comes from the pure model in src/lib/nav and the
 * role from the one cached /api/me read. Hiding a link is not authorisation: the API still checks.
 */
export function AppShell({
  children,
  consoleUrl = null,
}: {
  children: ReactNode;
  /** SP3 step 19: the console's home when CONSOLE_HOST is set (the server layout reads it); shown to the admin only. */
  consoleUrl?: string | null;
}) {
  const pathname = usePathname();
  const state = useMe();
  // M20: the service worker and, for table operators, the offline queue start once we know who is signed in.
  useSyncBoot(state);
  // SP2: another tab changed venue; this one reloads (the tabs share the session cookie).
  useTenantSwitchListener();
  return (
    <LeaveGuardProvider>
      <AppShellView state={state} pathname={pathname} consoleUrl={consoleUrl}>
        <DemoBanner />
        <SyncStatus role={state.me?.user.role} />
        {children}
      </AppShellView>
    </LeaveGuardProvider>
  );
}

export function AppShellView({
  state,
  pathname,
  consoleUrl = null,
  children,
}: {
  state: MeState;
  pathname: string;
  consoleUrl?: string | null;
  children?: ReactNode;
}) {
  const focus = isFocusRoute(pathname);
  const me = state.me;
  const groups = me ? navFor(me.user.role) : [];
  const tabs = me ? phoneTabs(me.user.role) : [];
  const tab = me ? currentTab(me.user.role, pathname) : null;
  const section = me ? currentSection(me.user.role, pathname) : null;
  const group = groups.find((g) => g.key === section?.group) ?? null;

  // A single tab (the waiter) needs no bar; a group of one section needs no row; /altro has no current section, so no row.
  const bar = me !== null && !focus && tabs.length > 1;
  const row = me !== null && !focus && group !== null && group.sections.length > 1;
  const waitingForRole = state.status === "loading" && !focus;

  return (
    <>
      <HeaderBand
        venue={VENUE_LAYER_DEFAULT}
        brand={<ShellBrandLink venue={VENUE_LAYER_DEFAULT} />}
        account={
          me ? (
            <>
              <AccountControl
                name={me.user.displayName}
                consoleUrl={me.user.role === "admin" ? consoleUrl : null}
              />
              {/* SP3 step 19: on a laptop the account control is hidden, so «Torna alla console» has its own place in the band (outside the sidebar's navigation). */}
              {me.user.role === "admin" && consoleUrl !== null && (
                <a
                  href={consoleUrl}
                  data-slot="console-return"
                  className="ml-auto hidden min-h-tap items-center text-sm font-bold text-band-ink underline underline-offset-4 focus-visible:outline-band-ink lg:inline-flex"
                >
                  {t("nav.backToConsole")}
                </a>
              )}
            </>
          ) : null
        }
      />
      <div className="lg:mx-auto lg:flex lg:justify-center lg:gap-10 lg:px-6">
        {me ? (
          <SidebarNavView
            groups={groups}
            currentHref={section?.href ?? null}
            userName={me.user.displayName}
            roleLabel={t(`role.${me.user.role}`)}
          />
        ) : (
          state.status === "loading" && (
            <div
              data-slot="sidebar-placeholder"
              aria-hidden="true"
              className="hidden w-56 shrink-0 lg:block"
            />
          )
        )}
        <PageMain
          className="lg:mx-0 lg:min-w-0 lg:max-w-3xl lg:flex-1"
          clearTabBar={bar || waitingForRole}
        >
          {row && group && <SectionNavView group={group} currentHref={section?.href ?? null} />}
          {waitingForRole && (
            <div data-slot="nav-placeholder" aria-hidden="true" className="-mt-2 h-11 lg:hidden" />
          )}
          {children}
        </PageMain>
        {bar && <BottomTabsView tabs={tabs} current={tab} />}
        {waitingForRole && (
          <div
            data-slot="nav-placeholder"
            aria-hidden="true"
            className="fixed inset-x-0 bottom-0 z-30 h-14 border-t border-rule bg-surface lg:hidden"
          />
        )}
      </div>
    </>
  );
}
