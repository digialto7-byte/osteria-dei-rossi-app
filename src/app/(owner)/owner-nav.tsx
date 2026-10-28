"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { canManageStaff } from "@/lib/staff-auth/staff-view";
import { canReadAlerts } from "@/lib/alerts/alert-view";
import { canReadKitchen } from "@/lib/kitchen/kitchen-view";
import { canReadPayables } from "@/lib/payables/payable-view";
import { canProduce } from "@/lib/batches/batch-view";
import { canReadStock } from "@/lib/stock/stock-view";
import { canReadRules } from "@/lib/rules/rules-view";
import { canEditMenu } from "@/lib/menu/menu-view";
import { canUseTables } from "@/lib/tables/table-view";
import { canReadCosts, canReadMargins } from "@/lib/costing/cost-view";
import { canReadRecipes } from "@/lib/recipes/recipe-view";
import { t } from "@/lib/i18n";
import { isCurrent } from "@/lib/nav/is-current";

const links = (role: string | null) => [
  { href: "/", label: t("nav.home") },
  ...(role !== null && canUseTables(role) ? [{ href: "/tavoli", label: t("nav.tables") }] : []),
  ...(role !== null && canReadKitchen(role) ? [{ href: "/cucina", label: t("nav.kitchen") }] : []),
  { href: "/fatture", label: t("nav.invoices") },
  ...(role !== null && canReadPayables(role)
    ? [{ href: "/pagamenti", label: t("nav.payables") }]
    : []),
  ...(role !== null && canReadAlerts(role) ? [{ href: "/avvisi", label: t("nav.alerts") }] : []),
  ...(role !== null && canReadRecipes(role) ? [{ href: "/ricette", label: t("nav.recipes") }] : []),
  ...(role !== null && canReadStock(role) ? [{ href: "/magazzino", label: t("nav.stock") }] : []),
  ...(role !== null && canProduce(role)
    ? [{ href: "/produzione", label: t("nav.production") }]
    : []),
  ...(role !== null && canReadRules(role) ? [{ href: "/riordino", label: t("nav.reorder") }] : []),
  ...(role !== null && canEditMenu(role) ? [{ href: "/menu", label: t("nav.menu") }] : []),
  ...(role !== null && canReadCosts(role) ? [{ href: "/costi", label: t("nav.costs") }] : []),
  ...(role !== null && canReadMargins(role) ? [{ href: "/margini", label: t("nav.margins") }] : []),
  ...(role !== null && canManageStaff(role) ? [{ href: "/personale", label: t("nav.staff") }] : []),
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
 * owner and admin (the payables carry money). "Costi" (euro costs) is for owner and admin; "Margini"
 * (percentages only) is the chef's tab; the waiter has neither. "Magazzino" (quantities only) is for owner,
 * admin and chef; the waiter has no access. "Produzione" (quantities only) is for owner, admin and chef too.
 * "Riordino" (reorder, prep and purchase rules; quantities and days only) is for owner, admin and chef; the waiter
 * has no access. "Tavoli" (the table grid, covers and bill flag) is for owner, admin and waiter; "Menu" (items, prices,
 * VAT; sale prices only) for owner and admin, so the chef has neither. "Cucina" (the sent dishes, no euro value) is for owner,
 * admin and chef; the waiter has no access. "Personale" (staff, PINs, devices) is for owner and admin.
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
