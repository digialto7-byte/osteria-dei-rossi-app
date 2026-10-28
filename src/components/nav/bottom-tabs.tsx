import Link from "next/link";
import { t } from "@/lib/i18n";
import type { GroupKey, NavGroup } from "@/lib/nav/nav-model";
import { tabClass } from "./nav-classes";

/**
 * The phone's bottom tab bar: one tab per group (at most 5), each to the group's landing page. Fixed to
 * the bottom and padded for the safe area; a focused field hides it (src/app/globals.css).
 */
export function BottomTabsView({
  groups,
  current,
}: {
  groups: NavGroup[];
  current: GroupKey | null;
}) {
  return (
    <nav
      data-slot="bottom-tabs"
      aria-label={t("nav.sections")}
      className="fixed inset-x-0 bottom-0 z-30 flex gap-1 border-t border-rule bg-surface px-2 pt-1.5 pb-[max(0.375rem,env(safe-area-inset-bottom))] lg:hidden"
    >
      {groups.map((group) => (
        <Link
          key={group.key}
          href={group.landing}
          aria-current={group.key === current ? "page" : undefined}
          className={tabClass(group.key === current)}
        >
          {t(group.labelKey)}
        </Link>
      ))}
    </nav>
  );
}
