import type { AppRole } from "@/lib/api/with-api";
import { canReadAlerts } from "@/lib/alerts/alert-view";
import { canProduce } from "@/lib/batches/batch-view";
import { canReadAudit } from "@/lib/counts/count-view";
import { canReadCosts, canReadMargins } from "@/lib/costing/cost-view";
import { canReadKitchen } from "@/lib/kitchen/kitchen-view";
import { canReadInvoices } from "@/lib/invoices/invoice-access";
import { canCloseDay } from "@/lib/day-close/day-close-view";
import { canEditMenu } from "@/lib/menu/menu-view";
import { canEditMasterData, canReadMasterData } from "@/lib/master/master-access";
import { canReadPayables } from "@/lib/payables/payable-view";
import { canReadPushList } from "@/lib/push/push-access";
import { canReadRecipes } from "@/lib/recipes/recipe-view";
import { canReadReports } from "@/lib/reports/report-view";
import { canSeeSafety } from "@/lib/safety/safety-view";
import { canReadRules } from "@/lib/rules/rules-view";
import { canManageStaff } from "@/lib/staff-auth/staff-view";
import { canReadStock } from "@/lib/stock/stock-view";
import { canUseReservations } from "@/lib/reservations/reservation-access";
import { canUseTables } from "@/lib/tables/table-view";
import type { MessageKey } from "@/lib/i18n";
import { isCurrent } from "./is-current";

// The single source of truth for what each role sees in the app shell (ADR-020, regrouped by ADR-030 in M25b). Pure: no React, no
// fetch. Hiding a link is not authorisation: every API role list and RLS policy stays as it is. No URL moved in M25b: only the
// grouping, the labels "Home" and "Attività" and the new /sicurezza placeholder changed.

export type GroupKey = "home" | "gestione" | "cucina" | "sala" | "anagrafica" | "registro";

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

/** A tab of the phone's bar: one group, or "altro" holding the groups that do not fit. */
export interface PhoneTab {
  key: GroupKey | "altro";
  labelKey: MessageKey;
  href: string;
  /** The groups this tab stands for (one, or the overflow groups for "altro"). */
  groups: GroupKey[];
}

/** The bar has at most five tabs (ADR-030, as ADR-020 limited it). */
export const MAX_TABS = 5;

const GROUPS: readonly { key: GroupKey; labelKey: MessageKey }[] = [
  { key: "home", labelKey: "nav.group.home" },
  { key: "gestione", labelKey: "nav.group.gestione" },
  { key: "cucina", labelKey: "nav.group.cucina" },
  { key: "sala", labelKey: "nav.group.sala" },
  { key: "anagrafica", labelKey: "nav.group.anagrafica" },
  { key: "registro", labelKey: "nav.group.registro" },
];

const ANY_STAFF = (role: string): boolean =>
  role === "owner" || role === "admin" || role === "chef" || role === "waiter";

// Order inside a group is the order here (the founder's order in Anagrafica and Registro; the screens he did not name go last).
// M19 "Comande" (/cucina) is first in Cucina and is not a focus route: the kitchen screen has no sticky bottom bar of its own, and
// the chef needs the tab bar and "Esci" (ADR-020). The phone row fits 6 pills: tests/lib/nav/nav-model.test.ts fails on a seventh.
const SECTIONS: readonly Section[] = [
  {
    href: "/",
    labelKey: "nav.today",
    group: "home",
    // The waiter lands on /tavoli instead (landingFor), so Home is not one of their sections.
    can: (role) => ANY_STAFF(role) && role !== "waiter",
  },
  { href: "/avvisi", labelKey: "nav.alerts", group: "home", can: canReadAlerts },
  // M23: the push list sits in Home, next to the alerts, for the owner, the admin and the chef (Q217).
  { href: "/spingere", labelKey: "nav.push", group: "home", can: canReadPushList },
  { href: "/fatture", labelKey: "nav.invoices", group: "gestione", can: canReadInvoices },
  { href: "/pagamenti", labelKey: "nav.payables", group: "gestione", can: canReadPayables },
  { href: "/cucina", labelKey: "nav.tickets", group: "cucina", can: canReadKitchen },
  { href: "/produzione", labelKey: "nav.production", group: "cucina", can: canProduce },
  { href: "/magazzino", labelKey: "nav.stock", group: "cucina", can: canReadStock },
  { href: "/riordino", labelKey: "nav.reorder", group: "cucina", can: canReadRules },
  // Margins in % are the chef's (the owner reads money margins in Report).
  { href: "/margini", labelKey: "nav.margins", group: "cucina", can: canReadMargins },
  { href: "/tavoli", labelKey: "nav.tables", group: "sala", can: canUseTables },
  // Reservations (A13): the day view of bookings, for the roles that serve the room. The chef has no access (the API answers 403 and the database 42501).
  { href: "/prenotazioni", labelKey: "nav.reservations", group: "sala", can: canUseReservations },
  { href: "/menu", labelKey: "nav.menu", group: "sala", can: canEditMenu },
  {
    href: "/anagrafiche/ubicazioni",
    labelKey: "nav.locations",
    group: "anagrafica",
    can: canEditMasterData,
  },
  { href: "/ricette", labelKey: "nav.recipes", group: "anagrafica", can: canReadRecipes },
  {
    href: "/anagrafiche/fornitori",
    labelKey: "nav.suppliers",
    group: "anagrafica",
    // The chef can still open the URL read-only, but it is not part of their daily jobs.
    can: canEditMasterData,
  },
  {
    href: "/anagrafiche/ingredienti",
    labelKey: "nav.ingredients",
    group: "anagrafica",
    // Read-only for the chef (allergens).
    can: canReadMasterData,
  },
  {
    href: "/personale",
    labelKey: "nav.staff",
    group: "anagrafica",
    can: canManageStaff,
    match: ["/dispositivi"],
  },
  {
    href: "/anagrafiche/importa",
    labelKey: "nav.import",
    group: "anagrafica",
    can: canEditMasterData,
  },
  // M25b: an empty "in arrivo" page, the entry of the future HACCP register (M31). Owner and admin only.
  { href: "/sicurezza", labelKey: "nav.safety", group: "registro", can: canSeeSafety },
  { href: "/costi", labelKey: "nav.costs", group: "registro", can: canReadCosts },
  { href: "/chiusura", labelKey: "nav.dayClose", group: "registro", can: canCloseDay },
  { href: "/report", labelKey: "nav.reports", group: "registro", can: canReadReports },
  // The change log is "Attività" in the nav so its pill never shares a name with the group "Registro" (Q215).
  { href: "/registro", labelKey: "nav.audit", group: "registro", can: canReadAudit },
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

/** The phone's tabs for a list of groups: one per group up to MAX_TABS, else the first four and "Altro" with the rest. */
export function tabsForGroups(groups: NavGroup[]): PhoneTab[] {
  const tab = (g: NavGroup): PhoneTab => ({
    key: g.key,
    labelKey: g.labelKey,
    href: g.landing,
    groups: [g.key],
  });
  if (groups.length <= MAX_TABS) return groups.map(tab);
  const direct = groups.slice(0, MAX_TABS - 1);
  const rest = groups.slice(MAX_TABS - 1);
  return [
    ...direct.map(tab),
    { key: "altro", labelKey: "nav.more", href: "/altro", groups: rest.map((g) => g.key) },
  ];
}

/** The tabs of the phone's bar for a role. */
export const phoneTabs = (role: AppRole): PhoneTab[] => tabsForGroups(navFor(role));

/** The groups inside the Altro tab for the role (empty when every group has its own tab). */
export function overflowGroups(role: AppRole): NavGroup[] {
  const altro = phoneTabs(role).find((tab) => tab.key === "altro");
  return altro ? navFor(role).filter((g) => altro.groups.includes(g.key)) : [];
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

/** The tab that holds the current page: its group's tab, "altro" for an overflow group or for /altro, or null. */
export function currentTab(role: AppRole, pathname: string): PhoneTab["key"] | null {
  const tabs = phoneTabs(role);
  const group = currentGroup(role, pathname);
  if (group) return tabs.find((tab) => tab.groups.includes(group))?.key ?? null;
  const altro = tabs.find((tab) => tab.key === "altro");
  return altro && isCurrent(pathname, "/altro") ? "altro" : null;
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

/** Where a role starts: the waiter on the tables, everyone else on Home. */
export function landingFor(role: AppRole): "/" | "/tavoli" {
  return role === "waiter" ? "/tavoli" : "/";
}
