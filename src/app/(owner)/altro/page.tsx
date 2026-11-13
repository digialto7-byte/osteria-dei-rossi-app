"use client";

import { NavLink } from "@/components/nav/nav-link";
import { MeProblem } from "@/components/me-problem";
import { useMe } from "@/components/use-me";
import { Heading, LedgerList, LedgerRow, Muted, SubHeading } from "@/components/ui";
import { t } from "@/lib/i18n";
import { overflowGroups } from "@/lib/nav/nav-model";

const ROW_LINK =
  "flex min-h-tap items-center justify-between gap-3 py-2.5 transition-colors hover:bg-sunk";

/**
 * "Altro" (M25b, ADR-030): the phone's fifth tab. One plain page with the groups that do not fit in the bar (Anagrafica and Registro for
 * the owner and the admin), each screen a 44 px link. It reads /api/me and the pure nav model only; it is not a drawer.
 */
export default function AltroPage() {
  const { status, me, retry } = useMe();
  const groups = me ? overflowGroups(me.user.role) : [];
  return (
    <>
      <Heading>{t("altro.title")}</Heading>
      {status === "loading" && <Muted>{t("home.loading")}</Muted>}
      {me === null && status !== "loading" && <MeProblem status={status} retry={retry} />}
      {me !== null && groups.length === 0 && <Muted>{t("altro.empty")}</Muted>}
      {groups.map((group) => (
        <section key={group.key} className="flex flex-col gap-2">
          <SubHeading>{t(group.labelKey)}</SubHeading>
          <LedgerList>
            {group.sections.map((section) => (
              <LedgerRow key={section.href}>
                <NavLink href={section.href} className={ROW_LINK}>
                  <span>{t(section.labelKey)}</span>
                  <span aria-hidden="true">›</span>
                </NavLink>
              </LedgerRow>
            ))}
          </LedgerList>
        </section>
      ))}
    </>
  );
}
