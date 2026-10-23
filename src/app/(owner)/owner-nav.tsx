"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { canReadAlerts } from "@/lib/alerts/alert-view";
import { canReadPayables } from "@/lib/payables/payable-view";
import { canReadRecipes } from "@/lib/recipes/recipe-view";
import { t } from "@/lib/i18n";
import { isCurrent } from "@/lib/nav/is-current";

const links = (role: string | null) => [
  { href: "/", label: t("nav.home") },
  { href: "/fatture", label: t("nav.invoices") },
  ...(role !== null && canReadPayables(role)
    ? [{ href: "/pagamenti", label: t("nav.payables") }]
    : []),
  ...(role !== null && canReadAlerts(role) ? [{ href: "/avvisi", label: t("nav.alerts") }] : []),
  ...(role !== null && canReadRecipes(role) ? [{ href: "/ricette", label: t("nav.recipes") }] : []),
  { href: "/anagrafiche/fornitori", label: t("nav.suppliers") },
  { href: "/anagrafiche/ingredienti", label: t("nav.ingredients") },
  { href: "/anagrafiche/ubicazioni", label: t("nav.locations") },
  { href: "/anagrafiche/importa", label: t("nav.import") },
];

/**
 * The owner's sections as a row of index tabs. At 360 px it wraps onto a second line rather than
 * hiding tabs off-screen; the current one (src/lib/nav/is-current.ts) is ink-filled with aria-current.
 * "Avvisi" is shown only to the roles that can read alerts (owner, chef), as on the home page;
 * "Ricette" to the roles that read recipes (owner, admin, chef), never the waiter; "Pagamenti" to
 * owner and admin (the payables carry money).
 */
export function OwnerNav() {
  const pathname = usePathname();
  const [role, setRole] = useState<string | null>(null);
  useEffect(() => {
    // The role comes from /api/me; until it is known (or if it fails) the Avvisi tab stays hidden.
    fetch("/api/me")
      .then(async (response) => {
        if (!response.ok) return;
        const me = (await response.json()) as { user?: { role?: string } };
        setRole(me.user?.role ?? null);
      })
      .catch(() => {});
  }, []);
  return <OwnerNavView pathname={pathname} role={role} />;
}

export function OwnerNavView({ pathname, role }: { pathname: string; role: string | null }) {
  return (
    <nav aria-label={t("nav.main")} className="-mt-2 flex flex-wrap gap-1.5">
      {links(role).map((link) => {
        const current = isCurrent(pathname, link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={current ? "page" : undefined}
            className={
              "inline-flex min-h-tap items-center rounded-full border px-3.5 text-[0.9375rem] " +
              "transition-colors duration-150 " +
              (current
                ? "border-ink bg-ink font-bold text-paper"
                : "border-rule bg-surface text-ink hover:border-rule-strong hover:bg-sunk")
            }
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
