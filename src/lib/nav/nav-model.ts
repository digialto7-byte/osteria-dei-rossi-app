import type { AppRole } from "@/lib/api/with-api";
import { canReadAlerts } from "@/lib/alerts/alert-view";
import { canProduce } from "@/lib/batches/batch-view";
import { canReadAudit } from "@/lib/counts/count-view";
import { canReadCosts, canReadMargins } from "@/lib/costing/cost-view";
import { canReadKitchen } from "@/lib/kitchen/kitchen-view";
import { canReadInvoices } from "@/lib/invoices/invoice-access";
import { canEditMenu } from "@/lib/menu/menu-view";
import { canEditMasterData, canReadMasterData } from "@/lib/master/master-access";
import { canReadPayables } from "@/lib/payables/payable-view";
import { canReadRecipes } from "@/lib/recipes/recipe-view";
import { canReadRules } from "@/lib/rules/rules-view";
import { canManageStaff } from "@/lib/staff-auth/staff-view";
import { canReadStock } from "@/lib/stock/stock-view";
import { canUseTables } from "@/lib/tables/table-view";
import type { MessageKey } from "@/lib/i18n";
import { isCurrent } from "./is-current";

// The single source of truth for what each role sees in the app shell (ADR-020). Pure: no React, no
// fetch. Hiding a link is not authorisation: every API role list and RLS policy stays as it is.

export type GroupKey = "oggi" | "acquisti" | "cucina" | "sala" | "gestione";

export interface Section {
  href: string;
  labelKey: MessageKey;
  group: GroupKey;
  /** Whether the role gets this section. Reuses the screens' own gates. */
  can: (role: string) => boolean;
  /** Extra path prefixes that also mark this section as current. */
  match?: readonly string[];
}

export interface NavGroup {
  key: GroupKey;
  labelKey: MessageKey;
  /** Where the group's tab leads: its first section for the role. */
  landing: string;
  sections: Section[];
}

const GROUPS: readonly { key: GroupKey; labelKey: MessageKey }[] = [
  { key: "oggi", labelKey: "nav.group.oggi" },
  { key: "acquisti", labelKey: "nav.group.acquisti" },
  { key: "cucina", labelKey: "nav.group.cucina" },
  { key: "sala", labelKey: "nav.group.sala" },
  { key: "gestione", labelKey: "nav.group.gestione" },
];

const ANY_STAFF = (role: string): boolean =>
  role === "owner" || role === "admin" || role === "chef" || role === "waiter";

// Order inside a group is the order here. Later milestones add one row each (M21 "Chiusura" in Sala), plus
// their own tests. M19 "Comande" (/cucina) is first in Cucina and is not a focus route: the kitchen screen has
// no sticky bottom bar of its own, and the chef needs the tab bar and "Esci" (ADR-020).
const SECTIONS: readonly Section[] = [
  {
    href: "/",
    labelKey: "nav.today",
    group: "oggi",
    // The waiter lands on /tavoli instead (landingFor), so Oggi is not one of their sections.
    can: (role) => ANY_STAFF(role) && role !== "waiter",
  },
  { href: "/avvisi", labelKey: "nav.alerts", group: "oggi", can: canReadAlerts },
  { href: "/fatture", labelKey: "nav.invoices", group: "acquisti", can: canReadInvoices },
  { href: "/pagamenti", labelKey: "nav.payables", group: "acquisti", can: canReadPayables },
  {
    href: "/anagrafiche/fornitori",
    labelKey: "nav.suppliers",
    group: "acquisti",
    // The chef can still open the URL read-only, but it is not part of their daily jobs.
    can: canEditMasterData,
  },
  { href: "/cucina", labelKey: "nav.tickets", group: "cucina", can: canReadKitchen },
  { href: "/produzione", labelKey: "nav.production", group: "cucina", can: canProduce },
  { href: "/magazzino", labelKey: "nav.stock", group: "cucina", can: canReadStock },
  { href: "/riordino", labelKey: "nav.reorder", group: "cucina", can: canReadRules },
  { href: "/ricette", labelKey: "nav.recipes", group: "cucina", can: canReadRecipes },
  { href: "/margini", labelKey: "nav.margins", group: "cucina", can: canReadMargins },
  { href: "/tavoli", labelKey: "nav.tables", group: "sala", can: canUseTables },
  { href: "/menu", labelKey: "nav.menu", group: "sala", can: canEditMenu },
  { href: "/costi", labelKey: "nav.costs", group: "gestione", can: canReadCosts },
  { href: "/registro", labelKey: "nav.audit", group: "gestione", can: canReadAudit },
  {
    href: "/personale",
    labelKey: "nav.staff",
    group: "gestione",
    can: canManageStaff,
    match: ["/dispositivi"],
  },
  {
    href: "/anagrafiche/ingredienti",
    labelKey: "nav.ingredients",
    group: "gestione",
    // Read-only for the chef (allergens).
    can: canReadMasterData,
  },
  {
    href: "/anagrafiche/ubicazioni",
    labelKey: "nav.locations",
    group: "gestione",
    can: canEditMasterData,
  },
  {
    href: "/anagrafiche/importa",
    labelKey: "nav.import",
    group: "gestione",
    can: canEditMasterData,
  },
];

/** The groups a role sees, in the fixed group order; groups with no section for the role are dropped. */
export function navFor(role: AppRole): NavGroup[] {
  const groups: NavGroup[] = [];
  for (const group of GROUPS) {
    const sections = SECTIONS.filter((s) => s.group === group.key && s.can(role));
    const first = sections[0];
    if (first) groups.push({ ...group, landing: first.href, sections });
  }
  return groups;
}

const isSectionCurrent = (section: Section, pathname: string): boolean =>
  [section.href, ...(section.match ?? [])].some((href) => isCurrent(pathname, href));

/** The section of the role that `pathname` belongs to, or null (a page outside the role's nav). */
export function currentSection(role: AppRole, pathname: string): Section | null {
  for (const group of navFor(role)) {
    const found = group.sections.find((s) => isSectionCurrent(s, pathname));
    if (found) return found;
  }
  return null;
}

/** The group of `currentSection`, or null. */
export function currentGroup(role: AppRole, pathname: string): GroupKey | null {
  return currentSection(role, pathname)?.group ?? null;
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
// Screens with their own sticky bottom bar (order sheet, close-count): no shell bar on them.
const FOCUS_ROUTES = [
  new RegExp(`^/tavoli/${UUID}/?$`, "i"),
  /^\/tavoli\/comanda\/?$/,
  new RegExp(`^/magazzino/conteggi/${UUID}/?$`, "i"),
];

/** True for the comanda (`/tavoli/comanda`, and the old `/tavoli/<uuid>`) and `/magazzino/conteggi/<uuid>` (a count in progress). */
export function isFocusRoute(pathname: string): boolean {
  return FOCUS_ROUTES.some((route) => route.test(pathname));
}

/** Where a role starts: the waiter on the tables, everyone else on Oggi. */
export function landingFor(role: AppRole): "/" | "/tavoli" {
  return role === "waiter" ? "/tavoli" : "/";
}
