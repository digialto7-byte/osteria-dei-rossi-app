import { z } from "zod";
import {
  GROUP_NAME_MAX,
  GROUP_SEATS_MAX,
  GROUP_SEATS_MIN,
  GROUP_TABLES_MAX,
  GROUP_TABLES_MIN,
  MAX_CLOSED_DATES,
  PRIVACY_EMAIL_MAX,
  PRIVACY_NAME_MAX,
  PRIVACY_NAME_MIN,
  RESERVATION_LIMIT_MAX,
  SERVICE_KEY_PATTERN,
  SETTINGS_RANGES,
  SLOT_MINUTES,
  SLUG_PATTERN,
  TABLE_BOOKING_MAX_ENTRIES,
  TABLE_SEATS_MAX,
  TABLE_SEATS_MIN,
  TIME_PATTERN,
  VENUE_PHONE_PATTERN,
} from "./constants";

// Strict bodies of the reservation endpoints (reservations plan §3.4). The bounds mirror the SQL procedures, which stay the authority.

export const idParams = z.object({ id: z.uuid() });
/** A body with no key at all. */
export const emptyBody = z.strictObject({});
/** A query string with no parameter at all. */
export const noQuery = z.strictObject({});

const range = ({ min, max }: { min: number; max: number }) => z.number().int().min(min).max(max);
const limit = z.number().int().min(1).max(RESERVATION_LIMIT_MAX).nullable();
const seatingTime = z.string().regex(TIME_PATTERN);

/** One service of the settings: exactly the seven keys, as the writer demands. First and last seating are both null or both a time, first not after last. */
const serviceBody = z
  .strictObject({
    key: z.string().regex(SERVICE_KEY_PATTERN),
    online: z.boolean(),
    firstSeating: seatingTime.nullable(),
    lastSeating: seatingTime.nullable(),
    coversPerSlot: limit,
    reservationsPerSlot: limit,
    coversPerService: limit,
  })
  .refine(
    (s) =>
      (s.firstSeating === null && s.lastSeating === null) ||
      (s.firstSeating !== null && s.lastSeating !== null && s.firstSeating <= s.lastSeating),
    { message: "seating" },
  );

const privacyName = z.string().trim().min(PRIVACY_NAME_MIN).max(PRIVACY_NAME_MAX);
const privacyEmail = z
  .string()
  .trim()
  .max(PRIVACY_EMAIL_MAX)
  .regex(/^[^@\s]+@[^@\s]+\.[^@\s]+$/);

/**
 * `PATCH /api/settings/reservations`: any of these keys; the rest stay as they are. null clears the slug, the phone and the two privacy fields.
 * `enabled: true` is refused by the database while the page is not ready.
 */
export const reservationSettingsBody = z
  .strictObject({
    enabled: z.boolean(),
    publicSlug: z.string().regex(SLUG_PATTERN).nullable(),
    venuePhone: z.string().regex(VENUE_PHONE_PATTERN).nullable(),
    slotMinutes: z.number().refine((n) => (SLOT_MINUTES as readonly number[]).includes(n)),
    stayMinutes: range(SETTINGS_RANGES.stayMinutes),
    leadMinutes: range(SETTINGS_RANGES.leadMinutes),
    horizonDays: range(SETTINGS_RANGES.horizonDays),
    maxPartyOnline: range(SETTINGS_RANGES.maxPartyOnline),
    cancelUntilMinutes: range(SETTINGS_RANGES.cancelUntilMinutes),
    retentionDays: range(SETTINGS_RANGES.retentionDays),
    closedWeekdays: z.array(z.number().int().min(1).max(7)).max(7),
    closedDates: z.array(z.iso.date()).max(MAX_CLOSED_DATES),
    services: z.array(serviceBody).max(6),
    privacyControllerName: privacyName.nullable(),
    privacyContactEmail: privacyEmail.nullable(),
  })
  .partial()
  .refine((body) => Object.values(body).some((value) => value !== undefined), {
    message: "nothing to change",
  });

/** `PUT /api/settings/reservations/tables`: the tables to change; a table not listed stays as it is. seats null means "not set". */
export const tableBookingBody = z.strictObject({
  tables: z
    .array(
      z.strictObject({
        tableId: z.uuid(),
        bookable: z.boolean(),
        seats: z.number().int().min(TABLE_SEATS_MIN).max(TABLE_SEATS_MAX).nullable(),
      }),
    )
    .min(1)
    .max(TABLE_BOOKING_MAX_ENTRIES),
});

/** `POST /api/table-groups`: a name, the group's own seats (not the sum) and 2 to 8 distinct tables. */
export const tableGroupBody = z.strictObject({
  name: z.string().trim().min(1).max(GROUP_NAME_MAX),
  seats: z.number().int().min(GROUP_SEATS_MIN).max(GROUP_SEATS_MAX),
  tableIds: z.array(z.uuid()).min(GROUP_TABLES_MIN).max(GROUP_TABLES_MAX),
});

export type ReservationSettingsBody = z.infer<typeof reservationSettingsBody>;
export type TableBookingBody = z.infer<typeof tableBookingBody>;
export type TableGroupBody = z.infer<typeof tableGroupBody>;
