import { z } from "zod";

/** Mirrors the 20-entry cap of public.set_tenant_settings; the database stays the authority for every value. */
export const MAX_VENUE_LIST = 20;

const KEYS = ["locale", "saleVatRates", "receiptTypes", "paymentTypes"] as const;

/**
 * PATCH /api/settings/venue (SP1 plan §3.3). Strict: an unknown key is a 400. Only the types and the list cap are checked here, so that
 * a wrong value (a rate outside the statute, a code outside the catalogue, an empty list) reaches the database and comes back as its
 * own 422 code. At least one key is required, as in SQL.
 */
export const venueSettingsPatch = z
  .strictObject({
    locale: z.string(),
    saleVatRates: z.array(z.number()).max(MAX_VENUE_LIST),
    receiptTypes: z.array(z.string()).max(MAX_VENUE_LIST),
    paymentTypes: z.array(z.string()).max(MAX_VENUE_LIST),
  })
  .partial()
  .refine((body) => KEYS.some((key) => body[key] !== undefined), { message: "nothing to change" });

export type VenueSettingsPatch = z.infer<typeof venueSettingsPatch>;
