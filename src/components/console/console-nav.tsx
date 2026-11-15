"use client";

import { usePathname } from "next/navigation";
import { NavLink } from "@/components/nav/nav-link";
import { pillClass, sidebarLinkClass } from "@/components/nav/nav-classes";
import { CONSOLE_SECTIONS, currentSection, type ConsoleSection } from "@/lib/console/console-nav";
import { t } from "@/lib/i18n";

/** The numbers after the labels; null while a read is loading or has failed (nothing is shown rather than a guess). */
export type SectionCounts = Record<"locali" | "avvisi", number | null>;

function countOf(section: ConsoleSection, counts: SectionCounts): number | null {
  if (section === "locali" || section === "avvisi") return counts[section];
  return null;
}

function SectionLink({
  section,
  current,
  counts,
  className,
}: {
  section: (typeof CONSOLE_SECTIONS)[number];
  current: boolean;
  counts: SectionCounts;
  className: string;
}) {
  const n = countOf(section.key, counts);
  return (
    <NavLink href={section.href} aria-current={current ? "page" : undefined} className={className}>
      {t(section.labelKey)}
      {n !== null && (
        <>
          {" "}
          <span className="num ml-auto pl-3">{n}</span>
        </>
      )}
    </NavLink>
  );
}

/** The laptop's sidebar (from lg): the three sections with their counts, then the account's name and the facts about the session. */
export function ConsoleSidebar({
  counts,
  displayName,
}: {
  counts: SectionCounts;
  displayName: string | null;
}) {
  const here = currentSection(usePathname());
  return (
    <aside data-testid="console-sidebar" className="hidden w-60 shrink-0 flex-col gap-6 lg:flex">
      <nav aria-label={t("console.nav.label")} className="flex flex-col gap-1">
        {CONSOLE_SECTIONS.map((section) => (
          <SectionLink
            key={section.key}
            section={section}
            current={here === section.key}
            counts={counts}
            className={sidebarLinkClass(here === section.key)}
          />
        ))}
      </nav>
      <div className="flex flex-col gap-0.5 border-t border-rule px-3 pt-4 text-sm text-ink-muted">
        {displayName !== null && <p className="font-bold text-ink">{displayName}</p>}
        <p>{t("console.footer.mfa")}</p>
        <p>{t("console.footer.times")}</p>
      </div>
    </aside>
  );
}

/** The phone's row of pills under the band (below lg). */
export function ConsolePills({ counts }: { counts: SectionCounts }) {
  const here = currentSection(usePathname());
  return (
    <nav
      aria-label={t("console.nav.label")}
      data-testid="console-pills"
      className="flex flex-wrap gap-2 lg:hidden"
    >
      {CONSOLE_SECTIONS.map((section) => (
        <SectionLink
          key={section.key}
          section={section}
          current={here === section.key}
          counts={counts}
          className={pillClass(here === section.key)}
        />
      ))}
    </nav>
  );
}
