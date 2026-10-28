import Link from "next/link";
import { t } from "@/lib/i18n";
import type { NavGroup } from "@/lib/nav/nav-model";
import { sidebarLinkClass } from "./nav-classes";

/** The laptop's left sidebar (from 1024 px): every group as a heading with its sections, and the user at the foot. */
export function SidebarNavView({
  groups,
  currentHref,
  userName,
  roleLabel,
}: {
  groups: NavGroup[];
  currentHref: string | null;
  userName: string;
  roleLabel: string;
}) {
  return (
    <nav
      data-slot="sidebar-nav"
      aria-label={t("nav.main")}
      className="sticky top-6 hidden w-56 shrink-0 flex-col gap-5 self-start pt-6 lg:flex"
    >
      {groups.map((group) => (
        <div key={group.key} className="flex flex-col gap-1">
          <h2 className="px-3 text-sm font-bold tracking-wide text-ink-muted uppercase">
            {t(group.labelKey)}
          </h2>
          {group.sections.map((section) => (
            <Link
              key={section.href}
              href={section.href}
              aria-current={section.href === currentHref ? "page" : undefined}
              className={sidebarLinkClass(section.href === currentHref)}
            >
              {t(section.labelKey)}
            </Link>
          ))}
        </div>
      ))}
      <div className="flex flex-col gap-0.5 border-t border-rule px-3 pt-4">
        <p className="font-bold">{userName}</p>
        <p className="text-ink-muted">{roleLabel}</p>
      </div>
    </nav>
  );
}
