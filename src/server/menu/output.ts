import { z } from "zod";
import { COURSES } from "./constants";

// Strict output schemas of the menu endpoints (M17 plan §3.4). The services parse every database reply here, so a
// column that is not declared (a cost that slipped into an RPC reply, say) makes the parse throw: a 500, never a
// leak. The waiter's shape has sale prices only: no cost, margin, GP, food cost or recipe key (AT4, snapshot-tested).

const course = z.enum(COURSES);

/** Why an item cannot be ordered: switched off, marked "esaurito" by the owner, or its batch is at 0 portions. */
export const UNAVAILABLE_REASONS = ["inactive", "manual", "no_portions"] as const;

/**
 * An item as the waiter sells it (M18: eleven keys). `available` combines the owner's switch and the stock;
 * `portionsLeft` is null for an item with no stock limit (unmapped, or a plate with no batch), else in half portions;
 * `lowStock` is the database's call (3 portions or fewer), so the screen does no arithmetic.
 */
export const serviceMenuItem = z.strictObject({
  id: z.uuid(),
  name: z.string(),
  category: z.string(),
  course,
  price: z.number(),
  available: z.boolean(),
  unavailableReason: z.enum(UNAVAILABLE_REASONS).nullable(),
  portionsLeft: z.number().nullable(),
  lowStock: z.boolean(),
  pushed: z.boolean(),
  pushPrice: z.number().nullable(),
});

/**
 * GET /api/menu: the same shape for every role that may read it. `pinned` lists the items pushed now (they also
 * stay in their category), in the database's order.
 */
export const serviceMenuOutput = z.strictObject({
  pinned: z.array(serviceMenuItem),
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
