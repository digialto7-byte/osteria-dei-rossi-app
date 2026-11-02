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

/** `POST /api/table-sessions/:id/service`: a key of the table's choices, or null for "automatic". The SQL checks the key against the version in force. */
export const sessionServiceBody = z.strictObject({
  serviceKey: z.string().regex(SERVICE_KEY).nullable(),
});

/** `?date=` the business date of the day close; absent means today's (the SQL's rule, up to 62 days back). */
export const dayServicesQuery = z.strictObject({ date: z.iso.date().optional() });

/** A query string with no parameter at all. */
export const noQuery = z.strictObject({});

export type SessionServiceBody = z.infer<typeof sessionServiceBody>;
export type DayServicesQuery = z.infer<typeof dayServicesQuery>;
export type ServicesBody = z.infer<typeof servicesBody>;
