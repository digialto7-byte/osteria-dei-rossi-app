import type { VenueSettings } from "@/lib/venue/settings";

/** The tenant_settings() reply of a tenant that has today's lists (SP1 step 9): the fixture of the /api/me tests. */
export const ME_SETTINGS: VenueSettings = {
  timeZone: "Europe/Rome",
  locale: "it",
  currency: "EUR",
  receiptTypes: ["scontrino", "fattura"],
  paymentTypes: ["cash", "card", "other"],
};
