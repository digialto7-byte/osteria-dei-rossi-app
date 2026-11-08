import { z } from "zod";
import { NOT_READY_REASONS } from "./constants";

// Strict output schemas of the reservation endpoints (reservations plan §3.4). The services parse every database reply here, so a key that is not
// declared (a cost that slipped into an RPC reply) makes the parse throw: a 500, never a leak. Reservations carry no money: no schema here has an
// amount, a cost or a price.

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
