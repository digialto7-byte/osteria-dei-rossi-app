import { z } from "zod";
import { MAX_TABLE_COVERS } from "@/server/tables/constants";
import {
  CONTACT_EMAIL_MAX,
  CONTACT_NAME_MAX,
  DECLINE_REASONS,
  MARKS,
  PARTY_MAX,
  PARTY_MIN,
  PICK_TABLES_MAX,
  STAFF_PHONE_PATTERN,
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

/** `?date=` the business date to read; absent means today's (the database's rule). */
export const reservationsDayQuery = z.strictObject({ date: z.iso.date().optional() });

/** `?date=` the business date of the booked covers, today to today + 6; absent means today's. The database decides the range (`date_out_of_range`). */
export const coversQuery = z.strictObject({ date: z.iso.date().optional() });

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

const party = z.number().int().min(PARTY_MIN).max(PARTY_MAX);
const date = z.iso.date();
const time = z.string().regex(TIME_PATTERN);
const serviceKey = z.string().regex(SERVICE_KEY_PATTERN);

/** accept and assign: both keys are required. null and null is "no table"; a group names its own tables, so tableIds must be its members. */
export const tablePickBody = z.strictObject({
  tableIds: z.array(z.uuid()).max(PICK_TABLES_MAX).nullable(),
  groupId: z.uuid().nullable(),
});
export const declineBody = z.strictObject({ reason: z.enum(DECLINE_REASONS) });
export const moveBody = z.strictObject({ date, time, serviceKey, party });
export const markBody = z.strictObject({ mark: z.enum(MARKS) });
/** The id of the session comes from the client (a retry is a replay). tableId is for a booking with no assigned table. */
export const seatBody = z.strictObject({
  sessionId: z.uuid(),
  covers: z.number().int().min(1).max(MAX_TABLE_COVERS),
  tableId: z.uuid().optional(),
});
/** The tables of a booking to give back to Sala; absent or null means every table but the lead. */
export const splitBody = z.strictObject({
  tableIds: z.array(z.uuid()).min(1).max(PICK_TABLES_MAX).nullable().optional(),
});

/**
 * `POST /api/reservations`: a booking typed by staff (a phone call). Name, phone, party, date and time are required; the e-mail is optional. There is no note key: free
 * text can carry health data (Q-R13), so any other key is refused.
 */
export const staffReservationBody = z.strictObject({
  date,
  time,
  serviceKey,
  party,
  name: z.string().trim().min(1).max(CONTACT_NAME_MAX),
  phone: z.string().regex(STAFF_PHONE_PATTERN),
  email: z
    .string()
    .trim()
    .max(CONTACT_EMAIL_MAX)
    .regex(/^[^@\s]+@[^@\s]+\.[^@\s]+$/)
    .nullable()
    .optional(),
  locale: z.enum(["it", "en"]).optional(),
  tableIds: z.array(z.uuid()).max(PICK_TABLES_MAX).nullable().optional(),
  groupId: z.uuid().nullable().optional(),
});

export type TablePickBody = z.infer<typeof tablePickBody>;
export type DeclineBody = z.infer<typeof declineBody>;
export type MoveBody = z.infer<typeof moveBody>;
export type MarkBody = z.infer<typeof markBody>;
export type SeatBody = z.infer<typeof seatBody>;
export type SplitBody = z.infer<typeof splitBody>;
export type StaffReservationBody = z.infer<typeof staffReservationBody>;
export type ReservationSettingsBody = z.infer<typeof reservationSettingsBody>;
export type TableBookingBody = z.infer<typeof tableBookingBody>;
export type TableGroupBody = z.infer<typeof tableGroupBody>;
