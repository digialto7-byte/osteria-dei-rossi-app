import { z } from "zod";
import {
  COURSES,
  MENU_CATEGORY_MAX,
  MENU_NAME_MAX,
  MENU_POSITION_MAX,
  MENU_PRICE_MAX,
  VAT_RATES,
} from "./constants";

// Strict bodies of the menu endpoints (M17 plan §3.4). The bounds mirror the SQL procedures, which stay the
// authority: the schema only turns the obvious mistakes into a 400 before any RPC. There is no implicit VAT rate:
// `vatRate` is required on creation. The push keys (pushUntil, pushPrice) are unknown keys here: M23 owns them.

export const idParams = z.object({ id: z.uuid() });

const text = (max: number) =>
  z
    .string()
    .max(max)
    .refine((value) => value.trim() !== "", { message: "blank" });

/**
 * True when the number is exactly its own 2-decimal rounding. Exact on purpose: the database refuses a JSON number
 * such as 0.30000000000000004, so a value with floating point noise is a 400 here, not a 422 later.
 */
export const hasTwoDecimals = (value: number): boolean => Number(value.toFixed(2)) === value;

/** A sale price: 0 to 10 000 with at most 2 decimals. */
export const price = z
  .number()
  .finite()
  .min(0)
  .max(MENU_PRICE_MAX)
  .refine(hasTwoDecimals, { message: "at most 2 decimals" });

export const vatRate = z.number().refine((v) => (VAT_RATES as readonly number[]).includes(v), {
  message: "VAT rate not allowed",
});

const fields = {
  name: text(MENU_NAME_MAX),
  category: text(MENU_CATEGORY_MAX),
  course: z.enum(COURSES),
  recipeKey: z.uuid().nullable(),
  price,
  vatRate,
  position: z.number().int().min(0).max(MENU_POSITION_MAX),
  available: z.boolean(),
  active: z.boolean(),
};

export const createMenuItemBody = z.strictObject({
  name: fields.name,
  category: fields.category,
  course: fields.course,
  recipeKey: fields.recipeKey,
  price: fields.price,
  vatRate: fields.vatRate,
  position: fields.position.optional(),
  available: fields.available.optional(),
});

export const updateMenuItemBody = z
  .strictObject({
    name: fields.name.optional(),
    category: fields.category.optional(),
    course: fields.course.optional(),
    recipeKey: fields.recipeKey.optional(),
    price: fields.price.optional(),
    vatRate: fields.vatRate.optional(),
    position: fields.position.optional(),
    available: fields.available.optional(),
    active: fields.active.optional(),
  })
  .refine((body) => Object.values(body).some((value) => value !== undefined), {
    message: "nothing to change",
  });

export type CreateMenuItemBody = z.infer<typeof createMenuItemBody>;
export type UpdateMenuItemBody = z.infer<typeof updateMenuItemBody>;
