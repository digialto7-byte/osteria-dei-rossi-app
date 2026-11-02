import { z } from "zod";
import { SERVICE_KEY, SERVICE_MAX_PERIODS, SERVICE_NAME_MAX, SERVICE_START } from "./constants";

// Strict inputs of the service endpoints (M25c plan §3.4). The SQL validates again and stays the authority.

/** `PATCH /api/settings/services`: the whole list, in screen order. A new period has key null. */
export const servicesBody = z.strictObject({
  periods: z
    .array(
      z.strictObject({
        key: z.string().regex(SERVICE_KEY).nullable(),
        name: z.string().trim().min(1).max(SERVICE_NAME_MAX),
        startsAt: z.string().regex(SERVICE_START),
      }),
    )
    .min(1)
    .max(SERVICE_MAX_PERIODS),
});

/** A query string with no parameter at all. */
export const noQuery = z.strictObject({});

export type ServicesBody = z.infer<typeof servicesBody>;
