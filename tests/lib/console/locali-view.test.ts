import { describe, expect, it } from "vitest";
import {
  ariaSort,
  detailMeta,
  digialtoWord,
  filterTenants,
  groupLabel,
  healthSentence,
  listMetaParts,
  localiHref,
  nextSort,
  parseLocaliQuery,
  peopleCount,
  peopleLine,
  peopleMeta,
  shownLine,
  sortTenants,
  tenantOptions,
  type SortableTenant,
} from "@/lib/console/locali-view";

const members = (owner = 0, admin = 0, chef = 0, waiter = 0) => ({ owner, admin, chef, waiter });
let seq = 0;
function tenant(over: Partial<SortableTenant> = {}): SortableTenant {
  seq += 1;
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    name: `Locale ${seq}`,
    organisation: { name: "Gruppo Demo", tenantCount: 1 },
    members: members(1),
    digialtoAttached: false,
    lastActivityDate: null,
    ...over,
  };
}
const q = (s: string) => new URLSearchParams(s);
const names = (list: readonly SortableTenant[]) => list.map((x) => x.name);

describe("parseLocaliQuery and localiHref", () => {
  it("reads ordina and verso", () => {
    expect(parseLocaliQuery(q("ordina=nome&verso=desc"))).toEqual({
      sort: { key: "nome", dir: "desc" },
      search: "",
    });
  });
  it("has no sort without a param", () => {
    expect(parseLocaliQuery(q("")).sort).toBeNull();
  });
  it("ignores an unknown ordina", () => {
    expect(parseLocaliQuery(q("ordina=prezzo&verso=asc")).sort).toBeNull();
  });
  it("uses the key's default for a bad verso", () => {
    expect(parseLocaliQuery(q("ordina=nome&verso=su")).sort).toEqual({ key: "nome", dir: "asc" });
    expect(parseLocaliQuery(q("ordina=attivita")).sort).toEqual({ key: "attivita", dir: "desc" });
  });
  it("ignores verso alone", () => {
    expect(parseLocaliQuery(q("verso=desc")).sort).toBeNull();
  });
  it("trims cerca", () => {
    expect(parseLocaliQuery(q("cerca=%20rossi%20")).search).toBe("rossi");
  });
  it("round-trips through localiHref", () => {
    expect(localiHref({ sort: null, search: "" })).toBe("/");
    const query = { sort: { key: "gruppo" as const, dir: "desc" as const }, search: "à b" };
    expect(parseLocaliQuery(new URL(localiHref(query), "http://x").searchParams)).toEqual(query);
    expect(localiHref({ sort: { key: "nome", dir: "asc" }, search: "" })).toBe(
      "/?ordina=nome&verso=asc",
    );
    expect(localiHref({ sort: null, search: "x" })).toBe("/?cerca=x");
  });
});

describe("nextSort and ariaSort", () => {
  it("starts a new key at its default direction", () => {
    expect(nextSort(null, "nome")).toEqual({ key: "nome", dir: "asc" });
    expect(nextSort({ key: "nome", dir: "asc" }, "attivita")).toEqual({
      key: "attivita",
      dir: "desc",
    });
  });
  it("flips the same key", () => {
    expect(nextSort({ key: "nome", dir: "asc" }, "nome")).toEqual({ key: "nome", dir: "desc" });
    expect(nextSort({ key: "attivita", dir: "desc" }, "attivita")).toEqual({
      key: "attivita",
      dir: "asc",
    });
  });
  it("reports aria-sort", () => {
    expect(ariaSort({ key: "nome", dir: "asc" }, "nome")).toBe("ascending");
    expect(ariaSort({ key: "nome", dir: "desc" }, "nome")).toBe("descending");
    expect(ariaSort({ key: "nome", dir: "desc" }, "gruppo")).toBe("none");
    expect(ariaSort(null, "nome")).toBe("none");
  });
});

describe("sortTenants", () => {
  const a = tenant({
    name: "Bar Demo",
    lastActivityDate: "2026-11-01",
    digialtoAttached: true,
    organisation: { name: "Zeta", tenantCount: 2 },
  });
  const b = tenant({
    name: "àlbero Demo",
    lastActivityDate: "2026-11-10",
    organisation: { name: "Alfa", tenantCount: 2 },
  });
  const c = tenant({ name: "Osteria Demo A", lastActivityDate: null });
  const list = [a, b, c];

  it("keeps the server order, as a copy, with no sort", () => {
    const out = sortTenants(list, null);
    expect(out).toEqual(list);
    expect(out).not.toBe(list);
  });
  it("sorts by name, accent-insensitive, both ways, without mutating", () => {
    expect(names(sortTenants(list, { key: "nome", dir: "asc" }))).toEqual([
      "àlbero Demo",
      "Bar Demo",
      "Osteria Demo A",
    ]);
    expect(names(sortTenants(list, { key: "nome", dir: "desc" }))).toEqual([
      "Osteria Demo A",
      "Bar Demo",
      "àlbero Demo",
    ]);
    expect(names(list)).toEqual(["Bar Demo", "àlbero Demo", "Osteria Demo A"]);
  });
  it("sorts by group with ungrouped venues last both ways", () => {
    expect(names(sortTenants(list, { key: "gruppo", dir: "asc" }))).toEqual([
      "àlbero Demo",
      "Bar Demo",
      "Osteria Demo A",
    ]);
    expect(names(sortTenants(list, { key: "gruppo", dir: "desc" }))).toEqual([
      "Bar Demo",
      "àlbero Demo",
      "Osteria Demo A",
    ]);
  });
  it("sorts by activity with nulls last both ways", () => {
    expect(names(sortTenants(list, { key: "attivita", dir: "desc" }))).toEqual([
      "àlbero Demo",
      "Bar Demo",
      "Osteria Demo A",
    ]);
    expect(names(sortTenants(list, { key: "attivita", dir: "asc" }))).toEqual([
      "Bar Demo",
      "àlbero Demo",
      "Osteria Demo A",
    ]);
  });
  it("sorts by DigiAlto, false before true, ties by name", () => {
    expect(names(sortTenants(list, { key: "digialto", dir: "asc" }))).toEqual([
      "àlbero Demo",
      "Osteria Demo A",
      "Bar Demo",
    ]);
    expect(names(sortTenants(list, { key: "digialto", dir: "desc" }))).toEqual([
      "Bar Demo",
      "àlbero Demo",
      "Osteria Demo A",
    ]);
  });
  it("is stable for equal names", () => {
    const x1 = tenant({ name: "Uguale" });
    const x2 = tenant({ name: "Uguale" });
    expect(sortTenants([x1, x2], { key: "nome", dir: "asc" })).toEqual([x1, x2]);
    expect(sortTenants([x2, x1], { key: "nome", dir: "desc" })).toEqual([x2, x1]);
  });
});

describe("filterTenants", () => {
  const a = tenant({
    name: "Osteria Demo A",
    organisation: { name: "Gruppo Città", tenantCount: 2 },
  });
  const b = tenant({ name: "Bar Demo", organisation: { name: "Gruppo Nascosto", tenantCount: 1 } });
  it("returns everything for an empty search", () => {
    expect(filterTenants([a, b], "")).toEqual([a, b]);
  });
  it("matches the name, ignoring case and accents", () => {
    expect(filterTenants([a, b], "OSTERIA")).toEqual([a]);
    expect(filterTenants([a, b], "citta")).toEqual([a]);
  });
  it("matches a group name only when it is shown", () => {
    expect(filterTenants([a, b], "nascosto")).toEqual([]);
  });
});

describe("labels", () => {
  it("groupLabel is null for a venue alone", () => {
    expect(groupLabel({ name: "G", tenantCount: 1 })).toBeNull();
    expect(groupLabel({ name: "G", tenantCount: 3 })).toBe("G");
  });
  it("counts and words people", () => {
    expect(peopleCount(members(1, 2, 3, 4))).toBe(10);
    expect(peopleMeta(members(1))).toBe("1 persona");
    expect(peopleMeta(members(1, 1, 1, 1))).toBe("4 persone");
    expect(peopleMeta(members())).toBe("0 persone");
  });
  it("words the shown line", () => {
    expect(shownLine(2, 2)).toBe("Mostro 2 locali.");
    expect(shownLine(1, 1)).toBe("Mostro 1 locale.");
    expect(shownLine(1, 2)).toBe("Mostro 1 di 2 locali.");
  });
  it("words DigiAlto", () => {
    expect(digialtoWord(true)).toBe("Sì");
    expect(digialtoWord(false)).toBe("No");
  });
  it("builds the phone meta line", () => {
    const withGroup = tenant({
      members: members(1, 1, 1, 1),
      organisation: { name: "Gruppo Demo", tenantCount: 2 },
      lastActivityDate: "2026-11-15",
      digialtoAttached: true,
    });
    expect(listMetaParts(withGroup, "2026-11-15")).toEqual({
      lead: "4 persone · Gruppo Demo · oggi",
      label: "DigiAlto",
      word: "sì",
      attached: true,
    });
    const alone = tenant({ members: members(1), lastActivityDate: null });
    expect(listMetaParts(alone, "2026-11-15")).toEqual({
      lead: "1 persona · — · —",
      label: "DigiAlto",
      word: "no",
      attached: false,
    });
  });
  it("builds the people line", () => {
    expect(peopleLine(members(1, 0, 1, 2), true)).toBe(
      "1 titolare · 1 cuoco · 2 camerieri · DigiAlto",
    );
    expect(peopleLine(members(0, 3), false)).toBe("3 admin");
    expect(peopleLine(members(), true)).toBe("DigiAlto");
    expect(peopleLine(members(), false)).toBe("nessuno");
  });
  it("builds the detail meta", () => {
    const alone = { ...tenant(), createdAt: "2026-10-21T09:00:00Z" };
    expect(detailMeta(alone)).toBe("nessun gruppo · creato il 21 ott 2026");
    const grouped = {
      ...tenant({ organisation: { name: "Gruppo Demo", tenantCount: 2 } }),
      createdAt: "2026-10-21T09:00:00Z",
    };
    expect(detailMeta(grouped)).toBe("Gruppo Demo · creato il 21 ott 2026");
  });
  it("has a health sentence only when DigiAlto is not attached", () => {
    expect(healthSentence(false)).toBe("DigiAlto non è collegato a questo locale.");
    expect(healthSentence(true)).toBeNull();
  });
  it("lists tenant options by name", () => {
    const x = tenant({ name: "Zeta" });
    const y = tenant({ name: "Alfa" });
    expect(tenantOptions([x, y])).toEqual([
      { value: y.id, label: "Alfa" },
      { value: x.id, label: "Zeta" },
    ]);
  });
});
