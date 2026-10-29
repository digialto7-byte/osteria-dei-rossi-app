import { describe, expect, it } from "vitest";
import { ingredientFacets, supplierFacets } from "@/lib/nav/facet-links";

// UX plan C4 (P2-4, L7): one ingredient or supplier is a row on several screens. Each screen links to the others the
// role may open; the screen you are on is left out. Costs are owner and admin only, so the chef never gets that link.

const ID = "1a000000-0000-4000-8000-00000000001a";
const STOCKED = { id: ID, isStock: true };
const hrefs = (links: { href: string }[]) => links.map((link) => link.href);

describe("ingredientFacets", () => {
  it("gives the owner the other three screens of a stock ingredient, in a fixed order", () => {
    expect(hrefs(ingredientFacets(STOCKED, "owner", "master"))).toEqual([
      `/magazzino/${ID}`,
      `/riordino/ingredienti#rule-ingredient-${ID}`,
      `/costi/ingredienti#ingredient-cost-${ID}`,
    ]);
  });

  it("words the links with the section words", () => {
    expect(ingredientFacets(STOCKED, "owner", "stock").map((link) => link.labelKey)).toEqual([
      "facet.master",
      "nav.reorder",
      "nav.costs",
    ]);
  });

  it("leaves out the screen you are on", () => {
    for (const current of ["master", "stock", "rules", "costs"] as const) {
      const links = ingredientFacets(STOCKED, "owner", current);
      expect(links).toHaveLength(3);
      expect(links.map((link) => link.facet)).not.toContain(current);
    }
  });

  it("gives the admin the same links as the owner", () => {
    expect(ingredientFacets(STOCKED, "admin", "master")).toEqual(
      ingredientFacets(STOCKED, "owner", "master"),
    );
  });

  it("never gives the chef the Costi link, on any screen", () => {
    for (const current of ["master", "stock", "rules", "costs"] as const) {
      const links = ingredientFacets(STOCKED, "chef", current);
      expect(links.map((link) => link.facet)).not.toContain("costs");
      expect(hrefs(links).join(" ")).not.toContain("/costi");
    }
  });

  it("gives the chef the stock, reorder and master screens it may open", () => {
    expect(ingredientFacets(STOCKED, "chef", "costs").map((link) => link.facet)).toEqual([
      "master",
      "stock",
      "rules",
    ]);
    expect(ingredientFacets(STOCKED, "chef", "master").map((link) => link.facet)).toEqual([
      "stock",
      "rules",
    ]);
    expect(ingredientFacets(STOCKED, "chef", "stock").map((link) => link.facet)).toEqual([
      "master",
      "rules",
    ]);
  });

  it("gives the waiter and an unknown or missing role nothing", () => {
    for (const role of ["waiter", "cook", "", null]) {
      expect(ingredientFacets(STOCKED, role, "master")).toEqual([]);
    }
  });

  it("offers no stock or reorder link for an ingredient that is not kept in stock", () => {
    const links = ingredientFacets({ id: ID, isStock: false }, "owner", "master");
    expect(links.map((link) => link.facet)).toEqual(["costs"]);
  });
});

describe("supplierFacets", () => {
  const SUPPLIER = "5a000000-0000-4000-8000-000000000001";

  it("links the supplier's record to its reorder rules, and back", () => {
    expect(hrefs(supplierFacets(SUPPLIER, "owner", "master"))).toEqual([
      `/riordino/fornitori#rule-supplier-${SUPPLIER}`,
    ]);
    expect(hrefs(supplierFacets(SUPPLIER, "owner", "rules"))).toEqual([
      `/anagrafiche/fornitori/${SUPPLIER}`,
    ]);
  });

  it("gives the chef both (it reads both), the waiter and no role nothing", () => {
    expect(supplierFacets(SUPPLIER, "chef", "master")).toHaveLength(1);
    expect(supplierFacets(SUPPLIER, "chef", "rules")).toHaveLength(1);
    expect(supplierFacets(SUPPLIER, "waiter", "master")).toEqual([]);
    expect(supplierFacets(SUPPLIER, null, "rules")).toEqual([]);
  });
});
