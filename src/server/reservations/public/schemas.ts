import { z } from "zod";
import {
  CONTACT_EMAIL_MAX,
  CONTACT_NAME_MAX,
  PARTY_MAX,
  PARTY_MIN,
  SERVICE_KEY_PATTERN,
  SLUG_PATTERN,
  STAFF_PHONE_PATTERN,
  TIME_PATTERN,
} from "../constants";

// Input of the public reservation endpoints (plan §3.4). Strict objects; the database checks every field again.

export const slugParams = z.object({ slug: z.string().regex(SLUG_PATTERN) });

/** `?date=&party=`: a calendar date and a whole number. The party is capped by the database (`maxPartyOnline`), not here. */
export const slotsQuery = z.strictObject({
  date: z.iso.date(),
  party: z
    .string()
    .regex(/^\d{1,2}$/)
    .transform(Number)
    .pipe(z.number().int().min(PARTY_MIN).max(PARTY_MAX)),
});

export const requestBody = z.strictObject({
  date: z.iso.date(),
  serviceKey: z.string().regex(SERVICE_KEY_PATTERN),
  time: z.string().regex(TIME_PATTERN),
  party: z.number().int().min(PARTY_MIN).max(PARTY_MAX),
  name: z.string().trim().min(1).max(CONTACT_NAME_MAX),
  phone: z.string().regex(STAFF_PHONE_PATTERN),
  email: z.string().trim().max(CONTACT_EMAIL_MAX).pipe(z.email()),
  locale: z.enum(["it", "en"]),
  /** The checkbox: the notice was read (not consent; plan §3.9). */
  privacyAck: z.literal(true),
  /** The honeypot: a person leaves it empty. */
  website: z.string().max(200),
  formToken: z.string().max(300),
});
export type PublicRequestBody = z.infer<typeof requestBody>;

export const cancelBody = z.strictObject({ token: z.string().max(300) });
export const cancelQuery = z.strictObject({ t: z.string().max(300) });
