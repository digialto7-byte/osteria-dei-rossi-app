import { describe, expect, it } from "vitest";
import { APP_ROLES } from "@/lib/api/with-api";
import { messages, type MessageKey } from "@/lib/i18n";
import { ingredientFacets, supplierFacets } from "@/lib/nav/facet-links";
import { navFor, phoneTabs } from "@/lib/nav/nav-model";

// Costì plan CB3 (§3.9): the product is "Costì", and the plate-cost section was labelled "Costi". Screen readers and readers in a hurry
// would mix them up, so no section, group, tab or facet label may be "Costì" once accents and case are removed, in either locale.
const normalise = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

function labelKeys(): Set<MessageKey> {
  const keys = new Set<MessageKey>();
  for (const role of APP_ROLES) {
    for (const group of navFor(role)) {
      keys.add(group.labelKey);
      for (const section of group.sections) keys.add(section.labelKey);
    }
    for (const tab of phoneTabs(role)) keys.add(tab.labelKey);
    for (const current of ["master", "stock", "rules", "costs"] as const) {
      for (const link of ingredientFacets({ id: "x", isStock: true }, role, current)) {
        keys.add(link.labelKey);
      }
    }
    for (const current of ["master", "rules"] as const) {
      for (const link of supplierFacets("x", role, current)) keys.add(link.labelKey);
    }
  }
  return keys;
}

describe("no nav or facet label reads as the product name", () => {
  it("collects a real set of labels (the guard is not vacuous)", () => {
    const keys = labelKeys();
    expect(keys.has("nav.costs")).toBe(true);
    expect(keys.has("costs.links.ingredients")).toBe(true);
    expect(keys.size).toBeGreaterThan(20);
  });

  it.each(["it", "en"] as const)(
    "%s: none equals Costi after removing accents and case",
    (locale) => {
      const clashes = [...labelKeys()]
        .map((key) => ({ key, label: messages[locale][key] }))
        .filter(({ label }) => normalise(label) === "costi");
      expect(clashes).toEqual([]);
    },
  );

  it("the normaliser folds Costì, COSTI and costi to one word", () => {
    for (const word of ["Costì", "COSTI", "costi", "Costi "])
      expect(normalise(word.trim())).toBe("costi");
  });

  it("the plate-cost section says what the page shows", () => {
    expect(messages.it["nav.costs"]).toBe("Costi dei piatti");
    expect(messages.en["nav.costs"]).toBe("Plate costs");
  });
});
