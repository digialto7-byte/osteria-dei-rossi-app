import { NavLink } from "./nav-link";
import { t } from "@/lib/i18n";
import type { PhoneTab } from "@/lib/nav/nav-model";
import { tabClass } from "./nav-classes";

/**
 * The phone's bottom tab bar: the role's tabs (at most 5; ADR-030): one per group, or four groups and "Altro". Fixed to
 * the bottom and padded for the safe area; a focused field hides it (src/app/globals.css).
 */
export function BottomTabsView({
  tabs,
  current,
}: {
  tabs: PhoneTab[];
  current: PhoneTab["key"] | null;
}) {
  return (
    <nav
      data-slot="bottom-tabs"
      aria-label={t("nav.sections")}
      className="fixed inset-x-0 bottom-0 z-30 flex gap-0.5 border-t border-rule bg-surface px-1 pt-1.5 pb-[max(0.375rem,env(safe-area-inset-bottom))] lg:hidden"
    >
      {tabs.map((tab) => (
        <NavLink
          key={tab.key}
          href={tab.href}
          aria-current={tab.key === current ? "page" : undefined}
          className={tabClass(tab.key === current)}
        >
          {t(tab.labelKey)}
        </NavLink>
      ))}
    </nav>
  );
}
