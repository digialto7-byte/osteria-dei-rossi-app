import { z } from "zod";
import { LOCALES } from "@/lib/i18n/locale";
import { PAYMENT_TYPES, RECEIPT_TYPES } from "@/server/bill/constants";

/** The only `Europe/Rome` literal in src/ (SP1 H9): the platform's zone, and the formatter's first-paint zone. */
export const DEFAULT_TIME_ZONE = "Europe/Rome";

function isZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** The venue settings /api/me answers (tenant_settings()): strict, so an unknown key such as a VAT list is refused. */
export const venueSettingsSchema = z.strictObject({
  timeZone: z.string().refine(isZone, "unknown time zone"),
  locale: z.enum(LOCALES),
  currency: z.literal("EUR"),
  receiptTypes: z.array(z.enum(RECEIPT_TYPES)).min(1),
  paymentTypes: z.array(z.enum(PAYMENT_TYPES)).min(1),
});
export type VenueSettings = z.infer<typeof venueSettingsSchema>;

/**
 * The ONE sanctioned default (lead ruling 2026-11-18, Rule B): what the formatters use BEFORE the store is
 * filled (first paint, server render). It is never a stand-in for missing or malformed settings: a reply
 * without valid settings is an error, and the store stays unfilled. Only src/lib/venue/current.ts reads it
 * (tests/guards/first-paint-defaults.test.ts).
 */
export const FIRST_PAINT_VENUE_SETTINGS: VenueSettings = {
  timeZone: DEFAULT_TIME_ZONE,
  locale: "it",
  currency: "EUR",
  receiptTypes: [...RECEIPT_TYPES],
  paymentTypes: [...PAYMENT_TYPES],
};
