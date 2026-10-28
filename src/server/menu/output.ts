import { z } from "zod";
import { COURSES } from "./constants";

// Strict output schemas of the menu endpoints (M17 plan §3.4). The services parse every database reply here, so a
// column that is not declared (a cost that slipped into an RPC reply, say) makes the parse throw: a 500, never a
// leak. The waiter's shape has sale prices only: no cost, margin, GP, food cost or recipe key (AT4, snapshot-tested).

const course = z.enum(COURSES);

export const serviceMenuItem = z.strictObject({
  id: z.uuid(),
  name: z.string(),
  category: z.string(),
  course,
  price: z.number(),
  available: z.boolean(),
  pushed: z.boolean(),
  pushPrice: z.number().nullable(),
});

/** GET /api/menu: the same shape for every role that may read it. */
export const serviceMenuOutput = z.strictObject({
  categories: z.array(z.strictObject({ name: z.string(), items: z.array(serviceMenuItem) })),
});

/** An item as the owner manages it (16 keys). recipeName and recipeActive are null when the item has no recipe. */
export const menuItemOutput = z.strictObject({
  id: z.uuid(),
  name: z.string(),
  category: z.string(),
  course,
  position: z.number().int(),
  recipeKey: z.uuid().nullable(),
  recipeName: z.string().nullable(),
  recipeActive: z.boolean().nullable(),
  unmapped: z.boolean(),
  price: z.number(),
  vatRate: z.number(),
  priceValidFrom: z.string(),
  available: z.boolean(),
  active: z.boolean(),
  pushUntil: z.string().nullable(),
  pushPrice: z.number().nullable(),
});

export const manageMenuOutput = z.strictObject({
  defaults: z.strictObject({ vatRate: z.number().nullable() }),
  vatRates: z.array(z.number()),
  courses: z.array(course),
  categories: z.array(z.string()),
  items: z.array(menuItemOutput),
});

export const createMenuItemOutput = z.strictObject({ item: menuItemOutput });
export const updateMenuItemOutput = z.strictObject({ changed: z.boolean(), item: menuItemOutput });

export type ServiceMenu = z.infer<typeof serviceMenuOutput>;
export type ServiceMenuItem = z.infer<typeof serviceMenuItem>;
export type MenuItem = z.infer<typeof menuItemOutput>;
export type ManageMenu = z.infer<typeof manageMenuOutput>;
