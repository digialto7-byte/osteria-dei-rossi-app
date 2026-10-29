import { describe, expect, it } from "vitest";
import { filterByName, normalizeName } from "@/lib/list/name-filter";

// UX plan C6 (P2-6): the name filter on long lists ignores case, accents and extra spaces.

const ITEMS = [
  { name: "Pomodoro San Marzano (demo)" },
  { name: "Crème fraîche (demo)" },
  { name: "Farina 00 (demo)" },
  { name: "Peperoncino (demo)" },
];
const names = (items: { name: string }[]) => items.map((item) => item.name);

describe("normalizeName", () => {
  it("lowercases, drops accents and collapses spaces", () => {
    expect(normalizeName("  Crème   FRAÎCHE ")).toBe("creme fraiche");
  });

  it("keeps digits and punctuation as they are", () => {
    expect(normalizeName("Farina 00 (demo)")).toBe("farina 00 (demo)");
  });

  it("is empty for blank input", () => {
    expect(normalizeName("   ")).toBe("");
  });
});

describe("filterByName", () => {
  it("finds a name whatever the case: 'pomodoro' finds 'Pomodoro San Marzano (demo)'", () => {
    expect(names(filterByName(ITEMS, "pomodoro"))).toEqual(["Pomodoro San Marzano (demo)"]);
    expect(names(filterByName(ITEMS, "POMODORO"))).toEqual(["Pomodoro San Marzano (demo)"]);
  });

  it("ignores accents on either side", () => {
    expect(names(filterByName(ITEMS, "creme"))).toEqual(["Crème fraîche (demo)"]);
    expect(names(filterByName([{ name: "Crema" }, { name: "Crème" }], "crème"))).toEqual(["Crème"]);
  });

  it("matches inside the name, not only at the start", () => {
    expect(names(filterByName(ITEMS, "marzano"))).toEqual(["Pomodoro San Marzano (demo)"]);
  });

  it("matches a phrase across words, ignoring extra spaces", () => {
    expect(names(filterByName(ITEMS, "  san   marzano "))).toEqual(["Pomodoro San Marzano (demo)"]);
  });

  it("keeps the order of the list", () => {
    expect(names(filterByName(ITEMS, "e"))).toEqual(names(ITEMS));
    expect(names(filterByName(ITEMS, "pe"))).toEqual(["Peperoncino (demo)"]);
  });

  it("returns the whole list for an empty or blank query", () => {
    expect(filterByName(ITEMS, "")).toEqual(ITEMS);
    expect(filterByName(ITEMS, "   ")).toEqual(ITEMS);
  });

  it("returns an empty list when nothing matches, and for an empty list", () => {
    expect(filterByName(ITEMS, "zafferano")).toEqual([]);
    expect(filterByName([], "pomodoro")).toEqual([]);
  });

  it("does not change the list it is given", () => {
    const copy = structuredClone(ITEMS);
    filterByName(ITEMS, "pomodoro");
    expect(ITEMS).toEqual(copy);
  });

  it("treats regex characters in the query as plain text", () => {
    expect(filterByName(ITEMS, ".*")).toEqual([]);
    expect(names(filterByName(ITEMS, "(demo)"))).toEqual(names(ITEMS));
  });
});
