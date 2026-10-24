import { describe, expect, it } from "vitest";
import {
  badgesFor,
  canEditMenu,
  courseWord,
  groupByCategory,
  priceLine,
} from "@/lib/menu/menu-view";

const ITEM = { unmapped: false, recipeActive: true, available: true, active: true };

describe("canEditMenu", () => {
  it("owner and admin only", () => {
    for (const role of ["owner", "admin"]) expect(canEditMenu(role), role).toBe(true);
    for (const role of ["waiter", "chef", "", "guest"]) expect(canEditMenu(role), role).toBe(false);
  });
});

describe("courseWord", () => {
  it("words the five courses in service order", () => {
    expect(["antipasti", "primi", "secondi", "dolci", "bevande"].map((c) => courseWord(c))).toEqual(
      ["Antipasti", "Primi", "Secondi", "Dolci", "Bevande"],
    );
    expect(courseWord("dolci", "en")).toBe("Desserts");
  });
  it("an unknown course is not shown as a raw code", () => {
    expect(courseWord("contorni")).not.toBe("contorni");
  });
});

describe("badgesFor", () => {
  it("a mapped, active, available item has none", () => {
    expect(badgesFor(ITEM)).toEqual([]);
  });
  it("unmapped -> Senza ricetta (warning)", () => {
    expect(badgesFor({ ...ITEM, unmapped: true, recipeActive: null })).toEqual([
      { id: "unmapped", tone: "warning", label: "Senza ricetta" },
    ]);
  });
  it("a deactivated recipe -> Ricetta disattivata", () => {
    expect(badgesFor({ ...ITEM, recipeActive: false }).map((b) => b.label)).toEqual([
      "Ricetta disattivata",
    ]);
  });
  it("an unmapped item is never also 'Ricetta disattivata'", () => {
    const labels = badgesFor({ ...ITEM, unmapped: true, recipeActive: false }).map((b) => b.label);
    expect(labels).toEqual(["Senza ricetta"]);
  });
  it("unavailable and inactive items are flagged", () => {
    expect(badgesFor({ ...ITEM, available: false }).map((b) => b.label)).toEqual([
      "Non disponibile",
    ]);
    expect(badgesFor({ ...ITEM, active: false }).map((b) => b.label)).toEqual(["Non attivo"]);
  });
  it("lists several in a fixed order", () => {
    expect(
      badgesFor({ unmapped: true, recipeActive: null, available: false, active: false }).map(
        (b) => b.id,
      ),
    ).toEqual(["inactive", "unmapped", "unavailable"]);
  });
  it("words them in English", () => {
    expect(badgesFor({ ...ITEM, unmapped: true, recipeActive: null }, "en")[0]!.label).toBe(
      "No recipe",
    );
  });
});

describe("priceLine", () => {
  it("words the price and the VAT rate", () => {
    expect(priceLine(1234.5, 10)).toMatch(/^1\.234,50\s€ · IVA 10 %$/);
    expect(priceLine(14, 10)).toMatch(/^14,00\s€ · IVA 10 %$/);
    expect(priceLine(2, 22)).toMatch(/^2,00\s€ · IVA 22 %$/);
  });
  it("shows a zero rate as 0 %", () => {
    expect(priceLine(0, 0)).toMatch(/^0,00\s€ · IVA 0 %$/);
  });
  it("shows 4,5 style rates with a comma", () => {
    expect(priceLine(3, 4.5)).toMatch(/IVA 4,5 %$/);
  });
});

describe("groupByCategory", () => {
  const item = (id: string, category: string) => ({ id, category });
  it("keeps the API's order of items and of categories (first appearance)", () => {
    const groups = groupByCategory([
      item("a", "Secondi"),
      item("b", "Bevande"),
      item("c", "Secondi"),
      item("d", "Dolci"),
    ]);
    expect(groups.map((g) => g.name)).toEqual(["Secondi", "Bevande", "Dolci"]);
    expect(groups[0]!.items.map((i) => i.id)).toEqual(["a", "c"]);
  });
  it("is empty for no items", () => {
    expect(groupByCategory([])).toEqual([]);
  });
});
