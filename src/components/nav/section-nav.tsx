import Link from "next/link";
import { t } from "@/lib/i18n";
import type { NavGroup } from "@/lib/nav/nav-model";
import { pillClass } from "./nav-classes";

/** The phone's row of pills for the current group's sections; it wraps rather than scrolls sideways. */
export function SectionNavView({
  group,
  currentHref,
}: {
  group: NavGroup;
  currentHref: string | null;
}) {
  return (
    <nav
      data-slot="section-nav"
      aria-label={t("nav.main")}
      className="-mt-2 flex flex-wrap gap-1.5 lg:hidden"
    >
      {group.sections.map((section) => (
        <Link
          key={section.href}
          href={section.href}
          aria-current={section.href === currentHref ? "page" : undefined}
          className={pillClass(section.href === currentHref)}
        >
          {t(section.labelKey)}
        </Link>
      ))}
    </nav>
  );
}
