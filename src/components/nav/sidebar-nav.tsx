import { NavLink } from "./nav-link";
import { LogoutButton } from "@/components/logout-button";
import { t } from "@/lib/i18n";
import type { NavGroup } from "@/lib/nav/nav-model";
import { sidebarLinkClass } from "./nav-classes";

/**
 * The laptop's left sidebar (from 1024 px): every group as a heading with its sections, and the user at the foot. Six groups can be taller
 * than an 800 px screen, so it scrolls inside itself (M25b); the page behind does not scroll sideways.
 */
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
      className="sticky top-6 hidden max-h-[calc(100dvh-1.5rem)] w-56 shrink-0 flex-col gap-5 self-start overflow-y-auto pt-6 lg:flex"
    >
      {groups.map((group) => (
        <div key={group.key} className="flex flex-col gap-1">
          <h2 className="px-3 text-sm font-bold tracking-wide text-ink-muted uppercase">
            {t(group.labelKey)}
          </h2>
          {group.sections.map((section) => (
            <NavLink
              key={section.href}
              href={section.href}
              aria-current={section.href === currentHref ? "page" : undefined}
              className={sidebarLinkClass(section.href === currentHref)}
            >
              {t(section.labelKey)}
            </NavLink>
          ))}
        </div>
      ))}
      <div className="flex flex-col gap-0.5 border-t border-rule px-3 pt-4">
        <p className="font-bold">{userName}</p>
        <p className="text-ink-muted">{roleLabel}</p>
        <div className="pt-2">
          <LogoutButton />
        </div>
      </div>
    </nav>
  );
}
