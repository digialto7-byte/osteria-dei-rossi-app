// Fake weighted dishes of the sell-by-weight suite (P2-0b plan §5 A9). Every name and number is invented; the prices are per etto
// (100 g), the reference portion is what one recipe portion weighs.

export const WEIGHT_NAMES = {
  steak: "Bistecca a peso (demo)",
  mushrooms: "Funghi fritti a peso (demo)",
  pasta: "Tagliatelle (demo)",
} as const;

/** The body of POST /api/menu/items for a dish sold by weight. */
export function weightedItemBody(
  name: string,
  category: string,
  course: string,
  pricePerEtto: number,
  portionWeightG: number,
  recipeKey: string | null,
): object {
  return {
    name,
    category,
    course,
    recipeKey,
    price: pricePerEtto,
    vatRate: 10,
    priceUnit: "etto",
    portionWeightG,
  };
}

/** The body of POST /api/menu/items for an ordinary dish sold by the portion. */
export function portionItemBody(
  name: string,
  category: string,
  course: string,
  price: number,
): object {
  return { name, category, course, recipeKey: null, price, vatRate: 10 };
}

/** Prices and weights of the A6 table, which the suite reproduces through the routes: total 89,66 €. */
export const WEIGHT_TABLE = {
  steakEtto: 4.25,
  steakG: 1230,
  steakAmount: 52.28,
  mushroomsEtto: 3.35,
  mushroomsG: 250,
  mushroomsAmount: 8.38,
  pasta: 14,
  covers: 4,
  coperto: 2,
  subtotal: 81.66,
  total: 89.66,
} as const;
