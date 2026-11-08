import { z } from "zod";
import { NOT_READY_REASONS, RESERVATION_ACTIONS, RESERVATION_STATUSES } from "./constants";

// Strict output schemas of the reservation endpoints (reservations plan §3.4). The services parse every database reply here, so a key that is not
// declared (a cost that slipped into an RPC reply) makes the parse throw: a 500, never a leak. Reservations carry no money: no schema here has an
// amount, a cost or a price.

/**
 * Parses a database reply and, on a mismatch, throws a plain Error that names the failing paths and codes only. A reply carries the personal data of customers (name,
 * phone, e-mail), so the Zod message is never passed on: nothing the reply held reaches the error reporter.
 */
export function parseReply<S extends z.ZodType>(schema: S, data: unknown): z.infer<S> {
  const parsed = schema.safeParse(data);
  if (parsed.success) return parsed.data;
  const where = parsed.error.issues
    .slice(0, 5)
    .map((issue) => `${issue.code}@${issue.path.join(".") || "(root)"}`)
    .join(", ");
  throw new Error(`Unexpected reservation reply: ${where}`);
}

const hhmm = z.string().regex(/^\d{2}:\d{2}$/);
const limit = z.number().int().nullable();

export const settingsService = z.strictObject({
  key: z.string(),
  name: z.string(),
  startsAt: hhmm,
  endsAt: hhmm,
  online: z.boolean(),
  firstSeating: hhmm.nullable(),
  lastSeating: hhmm.nullable(),
  coversPerSlot: limit,
  reservationsPerSlot: limit,
  coversPerService: limit,
});

const settingsShape = {
  enabled: z.boolean(),
  ready: z.boolean(),
  notReady: z.array(z.enum(NOT_READY_REASONS)),
  publicSlug: z.string().nullable(),
  venuePhone: z.string().nullable(),
  slotMinutes: z.number().int(),
  stayMinutes: z.number().int(),
  leadMinutes: z.number().int(),
  horizonDays: z.number().int(),
  maxPartyOnline: z.number().int(),
  cancelUntilMinutes: z.number().int(),
  retentionDays: z.number().int(),
  closedWeekdays: z.array(z.number().int()),
  closedDates: z.array(z.string()),
  services: z.array(settingsService),
  privacy: z.strictObject({
    controllerName: z.string().nullable(),
    controllerVat: z.string().nullable(),
    contactEmail: z.string().nullable(),
  }),
};

export const reservationSettingsOutput = z.strictObject(settingsShape);
export const setReservationSettingsOutput = z.strictObject({
  ...settingsShape,
  changed: z.boolean(),
});

const tableGroup = z.strictObject({
  id: z.uuid(),
  name: z.string(),
  seats: z.number().int(),
  isActive: z.boolean(),
  tableIds: z.array(z.uuid()),
});

const bookingShape = {
  tables: z.array(
    z.strictObject({
      tableId: z.uuid(),
      name: z.string(),
      position: z.number().int(),
      bookable: z.boolean(),
      seats: z.number().int().nullable(),
    }),
  ),
  groups: z.array(tableGroup),
};

export const tableBookingOutput = z.strictObject(bookingShape);
export const setTableBookingOutput = z.strictObject({ ...bookingShape, changed: z.boolean() });
export const createTableGroupOutput = z.strictObject({ group: tableGroup });
export const deactivateTableGroupOutput = z.strictObject({
  changed: z.boolean(),
  group: tableGroup,
});

export type ReservationSettings = z.infer<typeof reservationSettingsOutput>;
export type SettingsService = z.infer<typeof settingsService>;
export type TableBooking = z.infer<typeof tableBookingOutput>;
export type BookingTable = TableBooking["tables"][number];
export type TableGroup = z.infer<typeof tableGroup>;

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// The day view and the detail of a booking. Two shapes of a row: owner and admin have `emailStatus` (what the outbox did with the customer's mail), the waiter's
// reply has no such key and a key that should not be there is a parse error, so the waiter's screen can never show it.

const ref = z.strictObject({ id: z.uuid(), name: z.string() });
const status = z.enum(RESERVATION_STATUSES);
const action = z.enum(RESERVATION_ACTIONS);

const rowShape = {
  id: z.uuid(),
  time: hhmm,
  startsAt: z.string(),
  endsAt: z.string(),
  businessDate: z.string(),
  serviceKey: z.string(),
  party: z.number().int(),
  status,
  source: z.enum(["online", "staff"]),
  // The personal data: null once the contact is erased or purged.
  name: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  tables: z.array(z.strictObject({ id: z.uuid(), name: z.string(), joinedTo: ref.nullable() })),
  leadTable: ref.nullable(),
  groupName: z.string().nullable(),
  sessionId: z.uuid().nullable(),
  actions: z.array(action),
};
const emailStatus = z.string().nullable();

export const reservationRow = z.strictObject({ ...rowShape, emailStatus });
export const waiterReservationRow = z.strictObject(rowShape);

const dayShape = <R extends z.ZodType>(row: R) =>
  z.strictObject({
    businessDate: z.string(),
    services: z.array(
      z.strictObject({
        key: z.string(),
        name: z.string(),
        startsAt: hhmm.nullable(),
        endsAt: hhmm.nullable(),
        counts: z.strictObject({
          reservations: z.number().int(),
          covers: z.number().int(),
          pending: z.number().int(),
        }),
        reservations: z.array(row),
      }),
    ),
  });
export const reservationsDayOutput = dayShape(reservationRow);
export const waiterReservationsDayOutput = dayShape(waiterReservationRow);

const suggestionOption = z.strictObject({
  kind: z.enum(["table", "group"]),
  tableIds: z.array(z.uuid()),
  groupId: z.uuid().nullable(),
  seats: z.number().int(),
  tables: z.array(z.strictObject({ id: z.uuid(), name: z.string() })),
  groupName: z.string().nullable(),
});
export const suggestionOutput = z.strictObject({
  suggested: suggestionOption.nullable(),
  alternatives: z.array(suggestionOption),
});

// The events carry the kind and the time, never who did it.
const events = z.array(z.strictObject({ kind: z.string(), at: z.string() }));
export const reservationDetailOutput = z.strictObject({
  ...rowShape,
  emailStatus,
  events,
  suggestion: suggestionOutput.optional(),
});
export const waiterReservationDetailOutput = z.strictObject({ ...rowShape, events });

// What every action returns: the detail of the booking plus `changed` (false when the request equalled the current state).
export const reservationActionOutput = reservationDetailOutput.extend({ changed: z.boolean() });
export const waiterReservationActionOutput = waiterReservationDetailOutput.extend({
  changed: z.boolean(),
});

export const pendingCountOutput = z.strictObject({ pending: z.number().int() });

export type ReservationRow = z.infer<typeof reservationRow>;
export type WaiterReservationRow = z.infer<typeof waiterReservationRow>;
export type ReservationsDay = z.infer<typeof reservationsDayOutput>;
export type WaiterReservationsDay = z.infer<typeof waiterReservationsDayOutput>;
export type ReservationDetail = z.infer<typeof reservationDetailOutput>;
export type ReservationActionResult = z.infer<typeof reservationActionOutput>;
export type WaiterReservationDetail = z.infer<typeof waiterReservationDetailOutput>;
export type Suggestion = z.infer<typeof suggestionOutput>;
export type SuggestionOption = z.infer<typeof suggestionOption>;
export type PendingCount = z.infer<typeof pendingCountOutput>;
