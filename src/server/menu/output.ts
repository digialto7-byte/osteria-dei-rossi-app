import { z } from "zod";
import { COURSES } from "./constants";

// Strict output schemas of the menu endpoints (M17 plan §3.4). The services parse every database reply here, so a
// column that is not declared (a cost that slipped into an RPC reply, say) makes the parse throw: a 500, never a
// leak. The waiter's shape has sale prices only: no cost, margin, GP, food cost or recipe key (AT4, snapshot-tested).

const course = z.enum(COURSES);

/** Why an item cannot be ordered: switched off, marked "esaurito" by the owner, or its batch is at 0 portions. */
export const UNAVAILABLE_REASONS = ["inactive", "manual", "no_portions"] as const;

/** The unit of a sale price (P2-0b): per portion, or per etto (100 g) for a dish sold by weight. */
export const PRICE_UNITS = ["portion", "etto"] as const;

/**
 * An item as the waiter sells it (M18: eleven keys; P2-0b: fourteen). `available` combines the owner's switch and the stock;
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
  /** "etto" = the price is per 100 g and the dish is sold by weight (P2-0b); "portion" otherwise. */
  priceUnit: z.enum(PRICE_UNITS),
  /** The reference portion in grams of a weighted dish, null for a portion dish. */
  portionWeightG: z.number().int().nullable(),
  /** Grams left, floor(portions left x reference portion), for a weighted dish with a stock limit; else null. */
  weightLeftG: z.number().int().nullable(),
});

/**
 * GET /api/menu: the same shape for every role that may read it. `pinned` lists the items pushed now (they also
 * stay in their category), in the database's order.
 */
export const serviceMenuOutput = z.strictObject({
  /** The tenant's largest weight per line in grams, so the weight sheet validates offline with the database's number. */
  weightMaxG: z.number().int(),
  pinned: z.array(serviceMenuItem),
  categories: z.array(z.strictObject({ name: z.string(), items: z.array(serviceMenuItem) })),
});

/** An item as the owner manages it (18 keys). recipeName and recipeActive are null when the item has no recipe. */
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
  priceUnit: z.enum(PRICE_UNITS),
  portionWeightG: z.number().int().nullable(),
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

/** GET /api/settings/weight (owner and admin): the maximum in force, its default and the limits the field must respect. */
export const weightSettingsOutput = z.strictObject({
  weightMaxG: z.number().int(),
  defaultWeightMaxG: z.number().int(),
  minWeightG: z.number().int(),
  stepG: z.number().int(),
  settingMinG: z.number().int(),
  settingMaxG: z.number().int(),
});
/** PUT /api/settings/weight: whether anything changed, and the maximum now in force. */
export const setWeightSettingsOutput = z.strictObject({
  changed: z.boolean(),
  weightMaxG: z.number().int(),
});
export type WeightSettings = z.infer<typeof weightSettingsOutput>;
export type SetWeightSettings = z.infer<typeof setWeightSettingsOutput>;
