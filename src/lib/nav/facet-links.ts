import type { MessageKey } from "@/lib/i18n";
import { canReadCosts } from "@/lib/costing/cost-view";
import { canReadMasterData } from "@/lib/master/master-access";
import { canReadRules } from "@/lib/rules/rules-view";
import { canReadStock } from "@/lib/stock/stock-view";

// One ingredient or supplier is a row on several screens (UX plan P2-4, L7): its record, its stock, its reorder rules
// and its cost. Each screen links to the others the role may open. Pure: it picks links, it reads nothing. The anchors
// are the ids those rows carry, so a link lands on the row (see useScrollToHash).

export type IngredientFacet = "master" | "stock" | "rules" | "costs";
export type SupplierFacet = "master" | "rules";

export interface FacetLink {
  facet: IngredientFacet;
  labelKey: MessageKey;
  href: string;
}

/** The anchor id of a row on the reorder screens and the cost screen; the facet links point at them. */
export const ruleIngredientAnchor = (id: string) => `rule-ingredient-${id}`;
export const ruleSupplierAnchor = (id: string) => `rule-supplier-${id}`;
export const costIngredientAnchor = (id: string) => `ingredient-cost-${id}`;
export const masterIngredientAnchor = (id: string) => `ingredient-${id}`;

/**
 * The links from one ingredient on `current` to its other screens, for a role (null while it is not known: no links).
 * Stock and reorder rules exist for stock ingredients only; costs are for owner and admin, never the chef.
 */
export function ingredientFacets(
  ingredient: { id: string; isStock: boolean },
  role: string | null,
  current: IngredientFacet,
): FacetLink[] {
  if (role === null) return [];
  const { id } = ingredient;
  const all: (FacetLink & { allowed: boolean })[] = [
    {
      facet: "master",
      labelKey: "facet.master",
      href: `/anagrafiche/ingredienti#${masterIngredientAnchor(id)}`,
      allowed: canReadMasterData(role),
    },
    {
      facet: "stock",
      labelKey: "nav.stock",
      href: `/magazzino/${id}`,
      allowed: ingredient.isStock && canReadStock(role),
    },
    {
      facet: "rules",
      labelKey: "nav.reorder",
      href: `/riordino/ingredienti#${ruleIngredientAnchor(id)}`,
      allowed: ingredient.isStock && canReadRules(role),
    },
    {
      facet: "costs",
      labelKey: "nav.costs",
      href: `/costi/ingredienti#${costIngredientAnchor(id)}`,
      allowed: canReadCosts(role),
    },
  ];
  return all
    .filter((link) => link.facet !== current && link.allowed)
    .map(({ facet, labelKey, href }) => ({ facet, labelKey, href }));
}

/** The link from a supplier's record to its delivery rules and back. */
export function supplierFacets(
  supplierId: string,
  role: string | null,
  current: SupplierFacet,
): FacetLink[] {
  if (role === null) return [];
  if (current === "master") {
    return canReadRules(role)
      ? [
          {
            facet: "rules",
            labelKey: "nav.reorder",
            href: `/riordino/fornitori#${ruleSupplierAnchor(supplierId)}`,
          },
        ]
      : [];
  }
  return canReadMasterData(role)
    ? [{ facet: "master", labelKey: "facet.master", href: `/anagrafiche/fornitori/${supplierId}` }]
    : [];
}
