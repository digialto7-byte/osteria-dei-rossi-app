"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { BottomTabsView } from "@/components/nav/bottom-tabs";
import { SectionNavView } from "@/components/nav/section-nav";
import { SidebarNavView } from "@/components/nav/sidebar-nav";
import { PageMain } from "@/components/page-main";
import { useMe, type MeState } from "@/components/use-me";
import { t } from "@/lib/i18n";
import { currentSection, isFocusRoute, navFor } from "@/lib/nav/nav-model";
import { DemoBanner } from "./demo-banner";

/**
 * The shell around every signed-in page, home included (ADR-020): tab bar and section row on the phone,
 * sidebar on the laptop, the one `main`. The navigation comes from the pure model in src/lib/nav and the
 * role from the one cached /api/me read. Hiding a link is not authorisation: the API still checks.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const state = useMe();
  return (
    <AppShellView state={state} pathname={pathname}>
      <DemoBanner />
      {children}
    </AppShellView>
  );
}

export function AppShellView({
  state,
  pathname,
  children,
}: {
  state: MeState;
  pathname: string;
  children?: ReactNode;
}) {
  const focus = isFocusRoute(pathname);
  const me = state.me;
  const groups = me ? navFor(me.user.role) : [];
  const section = me ? currentSection(me.user.role, pathname) : null;
  const group = groups.find((g) => g.key === section?.group) ?? null;

  // A single group (the waiter) needs no tab bar; a group of one section needs no row.
  const bar = me !== null && !focus && groups.length > 1;
  const row = me !== null && !focus && group !== null && group.sections.length > 1;
  const waitingForRole = state.status === "loading" && !focus;

  return (
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
      <PageMain className="lg:mx-0 lg:min-w-0 lg:flex-1" clearTabBar={bar || waitingForRole}>
        {row && group && <SectionNavView group={group} currentHref={section?.href ?? null} />}
        {waitingForRole && (
          <div data-slot="nav-placeholder" aria-hidden="true" className="-mt-2 h-11 lg:hidden" />
        )}
        {children}
      </PageMain>
      {bar && <BottomTabsView groups={groups} current={section?.group ?? null} />}
      {waitingForRole && (
        <div
          data-slot="nav-placeholder"
          aria-hidden="true"
          className="fixed inset-x-0 bottom-0 z-30 h-14 border-t border-rule bg-surface lg:hidden"
        />
      )}
    </div>
  );
}
