import { z } from "zod";
import { hasTwoDecimals } from "@/server/menu/schemas";
import { PUSH_PRICE_MAX } from "./constants";

// Strict inputs of the push endpoints (M23 plan §3.4). The SQL stays the authority (the price against the menu price, the date window); the schemas
// only turn the obvious mistakes into a 400 before any RPC. The 2-decimal rule is the one the menu price already applies (hasTwoDecimals, T5).

const pushPrice = z.number().finite().positive().max(PUSH_PRICE_MAX).refine(hasTwoDecimals, {
  message: "at most 2 decimals",
});

/** `{ pushed: true, pushPrice?: 12.5 | null }` starts a push (no price means the menu price), `{ pushed: false }` stops it. */
export const pushBody = z.discriminatedUnion("pushed", [
  z.strictObject({ pushed: z.literal(true), pushPrice: pushPrice.nullable().default(null) }),
  z.strictObject({ pushed: z.literal(false) }),
]);

export const pushListQuery = z.strictObject({});

/** `?date=` a business date from today to today + 6; absent means today. The SQL decides the range. */
export const forecastQuery = z.strictObject({ date: z.iso.date().optional() });

/** `?week=<any date of the ISO week>`; absent means the current week. */
export const discardsQuery = z.strictObject({ week: z.iso.date().optional() });

export type PushBody = z.infer<typeof pushBody>;
export type PushListQuery = z.infer<typeof pushListQuery>;
export type ForecastQuery = z.infer<typeof forecastQuery>;
export type DiscardsQuery = z.infer<typeof discardsQuery>;
