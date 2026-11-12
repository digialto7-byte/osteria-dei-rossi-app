import { expect, type Page } from "@playwright/test";

// Fixtures of the sell-by-weight spec (P2-0b plan B9), fake data only. The dish is created as an ordinary portion dish through the
// signed-in owner's own API call; the spec then switches it to "a peso" on the menu screen, the way the owner does.

export const WEIGHTED_NAME = "Bistecca a peso (demo)";

/** As the signed-in owner: one unmapped portion dish (so firing it takes nothing from stock). Returns its id. */
export async function seedPortionDish(owner: Page, name = WEIGHTED_NAME): Promise<string> {
  const made = await owner.request.post("/api/menu/items", {
    data: { name, category: "Secondi", course: "secondi", recipeKey: null, price: 17, vatRate: 10 },
  });
  expect(made.status(), await made.text()).toBe(201);
  return ((await made.json()) as { item: { id: string } }).item.id;
}

/** Every object key at any depth, for a "no cost key" scan of an API reply. */
export function keysOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(keysOf);
  if (value !== null && typeof value === "object") {
    return Object.entries(value).flatMap(([key, inner]) => [key, ...keysOf(inner)]);
  }
  return [];
}
