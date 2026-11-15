import { t, tn } from "@/lib/i18n";
import { EM_DASH, formatActivityDay, formatLongDay } from "./console-dates";

export const SORT_KEYS = ["nome", "gruppo", "attivita", "digialto"] as const;
export type SortKey = (typeof SORT_KEYS)[number];
export type SortDir = "asc" | "desc";
export interface Sort {
  key: SortKey;
  dir: SortDir;
}
export interface LocaliQuery {
  sort: Sort | null;
  search: string;
}

/** The fields of a tenant the list needs (a local copy of the console API's shape). */
export interface SortableTenant {
  id: string;
  name: string;
  organisation: { name: string; tenantCount: number };
  members: { owner: number; admin: number; chef: number; waiter: number };
  digialtoAttached: boolean;
  lastActivityDate: string | null;
}

const defaultDir = (key: SortKey): SortDir => (key === "attivita" ? "desc" : "asc");
const isSortKey = (value: string | null): value is SortKey =>
  value !== null && (SORT_KEYS as readonly string[]).includes(value);

/** Reads the sort and the search from the address. An unknown `ordina` means the server order. */
export function parseLocaliQuery(params: URLSearchParams): LocaliQuery {
  const key = params.get("ordina");
  const verso = params.get("verso");
  const search = (params.get("cerca") ?? "").trim();
  if (!isSortKey(key)) return { sort: null, search };
  const dir = verso === "asc" || verso === "desc" ? verso : defaultDir(key);
  return { sort: { key, dir }, search };
}

/** The visible address for a query: "/" when nothing is set. */
export function localiHref(query: LocaliQuery): string {
  const params = new URLSearchParams();
  if (query.sort) {
    params.set("ordina", query.sort.key);
    params.set("verso", query.sort.dir);
  }
  if (query.search !== "") params.set("cerca", query.search);
  const text = params.toString();
  return text === "" ? "/" : `/?${text}`;
}

export function nextSort(current: Sort | null, key: SortKey): Sort {
  if (current && current.key === key) return { key, dir: current.dir === "asc" ? "desc" : "asc" };
  return { key, dir: defaultDir(key) };
}

export function ariaSort(current: Sort | null, key: SortKey): "ascending" | "descending" | "none" {
  if (!current || current.key !== key) return "none";
  return current.dir === "asc" ? "ascending" : "descending";
}

export function groupLabel(org: { name: string; tenantCount: number }): string | null {
  return org.tenantCount === 1 ? null : org.name;
}

const byText = (a: string, b: string) => a.localeCompare(b, "it", { sensitivity: "base" });

/** Sorts a copy. Ties are broken by name; missing groups and dates go last in both directions. */
export function sortTenants<T extends SortableTenant>(
  tenants: readonly T[],
  sort: Sort | null,
): T[] {
  const copy = [...tenants];
  if (!sort) return copy;
  const sign = sort.dir === "asc" ? 1 : -1;
  const withNulls = (
    a: string | null,
    b: string | null,
    compare: (x: string, y: string) => number,
  ) => {
    if (a === null && b === null) return 0;
    if (a === null) return 1;
    if (b === null) return -1;
    return sign * compare(a, b);
  };
  const primary = (a: T, b: T): number => {
    switch (sort.key) {
      case "nome":
        return sign * byText(a.name, b.name);
      case "gruppo":
        return withNulls(groupLabel(a.organisation), groupLabel(b.organisation), byText);
      case "attivita":
        return withNulls(a.lastActivityDate, b.lastActivityDate, (x, y) =>
          x < y ? -1 : x > y ? 1 : 0,
        );
      case "digialto":
        return sign * (Number(a.digialtoAttached) - Number(b.digialtoAttached));
    }
  };
  return copy.sort((a, b) => primary(a, b) || byText(a.name, b.name));
}

const fold = (value: string) =>
  value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

/** Case- and accent-insensitive match on the name, or on the group name when the list shows one. */
export function filterTenants<T extends SortableTenant>(
  tenants: readonly T[],
  search: string,
): T[] {
  const needle = fold(search.trim());
  if (needle === "") return [...tenants];
  return tenants.filter((tenant) => {
    const group = groupLabel(tenant.organisation);
    return fold(tenant.name).includes(needle) || (group !== null && fold(group).includes(needle));
  });
}

export function peopleCount(m: SortableTenant["members"]): number {
  return m.owner + m.admin + m.chef + m.waiter;
}

export function peopleMeta(m: SortableTenant["members"]): string {
  return tn("console.locali.people", peopleCount(m));
}

export function shownLine(shown: number, total: number): string {
  return shown === total
    ? tn("console.locali.shown", shown)
    : t("console.locali.shownOf", { n: shown, totale: total });
}

export function digialtoWord(attached: boolean): string {
  return t(attached ? "console.yes" : "console.no");
}

/** The phone list's second line: "4 persone · Gruppo Demo · oggi · DigiAlto: sì". */
export function listMeta(tenant: SortableTenant, today: string): string {
  return [
    peopleMeta(tenant.members),
    groupLabel(tenant.organisation) ?? EM_DASH,
    formatActivityDay(tenant.lastActivityDate, today),
    t(
      tenant.digialtoAttached
        ? "console.locali.digialtoMeta.yes"
        : "console.locali.digialtoMeta.no",
    ),
  ].join(" · ");
}

/** "1 titolare · 1 cuoco · 2 camerieri · DigiAlto"; roles with nobody are left out. */
export function peopleLine(m: SortableTenant["members"], attached: boolean): string {
  const parts: string[] = [];
  if (m.owner > 0) parts.push(tn("console.role.owner", m.owner));
  if (m.admin > 0) parts.push(tn("console.role.admin", m.admin));
  if (m.chef > 0) parts.push(tn("console.role.chef", m.chef));
  if (m.waiter > 0) parts.push(tn("console.role.waiter", m.waiter));
  if (attached) parts.push(t("console.detail.usage.digialto"));
  return parts.length > 0 ? parts.join(" · ") : t("console.detail.usage.nobody");
}

export function detailMeta(tenant: SortableTenant & { createdAt: string }): string {
  return [
    groupLabel(tenant.organisation) ?? t("console.detail.noGroup"),
    t("console.createdOn", { date: formatLongDay(tenant.createdAt) }),
  ].join(" · ");
}

/** The Salute section: only when DigiAlto is not connected. When it is, there is no section. */
export function healthSentence(attached: boolean): string | null {
  return attached ? null : t("console.detail.health.notAttached");
}

export function tenantOptions<T extends SortableTenant>(
  tenants: readonly T[],
): { value: string; label: string }[] {
  return [...tenants]
    .sort((a, b) => byText(a.name, b.name))
    .map((tenant) => ({ value: tenant.id, label: tenant.name }));
}
