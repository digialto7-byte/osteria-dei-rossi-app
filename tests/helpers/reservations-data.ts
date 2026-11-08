// Fixtures of the reservation endpoints (fake data only: "Cliente Demo", "Tavolo 1 (demo)", example.com addresses).
import type {
  ReservationRow,
  Suggestion,
  WaiterReservationRow,
} from "@/server/reservations/output";

export const TABLE_1 = "21000000-0000-4000-8000-000000000001";
export const TABLE_2 = "21000000-0000-4000-8000-000000000002";
export const TABLE_3 = "21000000-0000-4000-8000-000000000003";
export const GROUP_1 = "22000000-0000-4000-8000-000000000001";
export const RESERVATION_1 = "23000000-0000-4000-8000-000000000001";
export const RESERVATION_2 = "23000000-0000-4000-8000-000000000002";
export const SESSION_1 = "24000000-0000-4000-8000-000000000001";

export const RESERVATION_SETTINGS = {
  enabled: false,
  ready: false,
  notReady: ["slug", "privacy_name", "privacy_email"] as (
    "slug" | "privacy_name" | "privacy_email" | "seating"
  )[],
  publicSlug: null as string | null,
  venuePhone: null as string | null,
  slotMinutes: 15,
  stayMinutes: 120,
  leadMinutes: 120,
  horizonDays: 60,
  maxPartyOnline: 8,
  cancelUntilMinutes: 0,
  retentionDays: 30,
  closedWeekdays: [] as number[],
  closedDates: [] as string[],
  services: [
    {
      key: "pranzo",
      name: "Pranzo",
      startsAt: "11:00",
      endsAt: "16:00",
      online: true,
      firstSeating: "12:00" as string | null,
      lastSeating: "14:00" as string | null,
      coversPerSlot: null as number | null,
      reservationsPerSlot: null as number | null,
      coversPerService: null as number | null,
    },
    {
      key: "cena",
      name: "Cena",
      startsAt: "16:00",
      endsAt: "02:00",
      online: true,
      firstSeating: "19:30" as string | null,
      lastSeating: "22:00" as string | null,
      coversPerSlot: null as number | null,
      reservationsPerSlot: null as number | null,
      coversPerService: null as number | null,
    },
  ],
  privacy: {
    controllerName: null as string | null,
    controllerVat: "IT00000000000" as string | null,
    contactEmail: null as string | null,
  },
};

export const SET_RESERVATION_SETTINGS = { ...RESERVATION_SETTINGS, changed: true };

export const TABLE_BOOKING = {
  tables: [
    { tableId: TABLE_1, name: "Tavolo 1 (demo)", position: 1, bookable: true, seats: 2 },
    { tableId: TABLE_2, name: "Tavolo 2 (demo)", position: 2, bookable: true, seats: 4 },
    { tableId: TABLE_3, name: "Tavolo 3 (demo)", position: 3, bookable: false, seats: null },
  ] as {
    tableId: string;
    name: string;
    position: number;
    bookable: boolean;
    seats: number | null;
  }[],
  groups: [
    {
      id: GROUP_1,
      name: "Tavoli 1+2",
      seats: 6,
      isActive: true,
      tableIds: [TABLE_1, TABLE_2],
    },
  ],
};

export const SET_TABLE_BOOKING = { ...TABLE_BOOKING, changed: true };

export const CREATE_TABLE_GROUP = { group: TABLE_BOOKING.groups[0]! };

export const DEACTIVATE_TABLE_GROUP = {
  changed: true,
  group: { ...TABLE_BOOKING.groups[0]!, isActive: false },
};

/** A pending online request, as the owner reads it (the personal data is a fake "Cliente Demo"). */
export const ROW_PENDING: ReservationRow = {
  id: RESERVATION_1,
  time: "20:00",
  startsAt: "2026-11-20T19:00:00+00:00",
  endsAt: "2026-11-20T21:00:00+00:00",
  businessDate: "2026-11-20",
  serviceKey: "cena",
  party: 4,
  status: "pending",
  source: "online",
  name: "Cliente Demo",
  phone: "390000000001",
  email: "cliente.demo@example.com",
  tables: [],
  leadTable: null,
  groupName: null,
  sessionId: null,
  actions: ["accept", "decline", "move", "erase"],
  emailStatus: "sent",
};

/** An accepted booking on two tables of a group (Tavolo 2 is joined to Tavolo 1). */
export const ROW_ACCEPTED: ReservationRow = {
  ...ROW_PENDING,
  id: RESERVATION_2,
  time: "20:30",
  startsAt: "2026-11-20T19:30:00+00:00",
  endsAt: "2026-11-20T21:30:00+00:00",
  party: 6,
  status: "accepted",
  name: "Cliente Due Demo",
  phone: "390000000002",
  email: null,
  tables: [
    { id: TABLE_1, name: "Tavolo 1 (demo)", joinedTo: null },
    { id: TABLE_2, name: "Tavolo 2 (demo)", joinedTo: { id: TABLE_1, name: "Tavolo 1 (demo)" } },
  ],
  leadTable: { id: TABLE_1, name: "Tavolo 1 (demo)" },
  groupName: "Tavoli 1+2",
  actions: ["decline", "move", "tables", "arrived", "seat", "erase"],
  emailStatus: null,
};

const { emailStatus: _owner, ...WAITER_BASE } = ROW_PENDING;
const { emailStatus: _owner2, ...WAITER_ACCEPTED } = ROW_ACCEPTED;
export const WAITER_ROW_PENDING: WaiterReservationRow = { ...WAITER_BASE, actions: [] };
export const WAITER_ROW_ACCEPTED: WaiterReservationRow = {
  ...WAITER_ACCEPTED,
  actions: ["arrived", "seat"],
};

const dayShape = <R>(rows: R[]) => ({
  businessDate: "2026-11-20",
  services: [
    {
      key: "pranzo",
      name: "Pranzo",
      startsAt: "11:00",
      endsAt: "16:00",
      counts: { reservations: 0, covers: 0, pending: 0 },
      reservations: [] as R[],
    },
    {
      key: "cena",
      name: "Cena",
      startsAt: "16:00",
      endsAt: "02:00",
      counts: { reservations: 2, covers: 10, pending: 1 },
      reservations: rows,
    },
  ],
});
export const RESERVATIONS_DAY = dayShape([ROW_PENDING, ROW_ACCEPTED]);
export const WAITER_RESERVATIONS_DAY = dayShape([WAITER_ROW_PENDING, WAITER_ROW_ACCEPTED]);

export const SUGGESTION: Suggestion = {
  suggested: {
    kind: "table",
    tableIds: [TABLE_2],
    groupId: null,
    seats: 4,
    tables: [{ id: TABLE_2, name: "Tavolo 2 (demo)" }],
    groupName: null,
  },
  alternatives: [
    {
      kind: "group",
      tableIds: [TABLE_1, TABLE_2],
      groupId: GROUP_1,
      seats: 6,
      tables: [
        { id: TABLE_1, name: "Tavolo 1 (demo)" },
        { id: TABLE_2, name: "Tavolo 2 (demo)" },
      ],
      groupName: "Tavoli 1+2",
    },
  ],
};

export const RESERVATION_DETAIL = {
  ...ROW_PENDING,
  events: [{ kind: "requested", at: "2026-11-08T10:00:00+00:00" }],
  suggestion: SUGGESTION,
};
export const WAITER_RESERVATION_DETAIL = {
  ...WAITER_ROW_ACCEPTED,
  events: [
    { kind: "requested", at: "2026-11-08T10:00:00+00:00" },
    { kind: "accepted", at: "2026-11-08T10:05:00+00:00" },
  ],
};

export const PENDING_COUNT = { pending: 3 };

/** What an action returns: the detail of the booking plus `changed`. */
export const ACTION_RESULT = {
  ...ROW_ACCEPTED,
  events: [{ kind: "accepted", at: "2026-11-08T10:05:00+00:00" }],
  changed: true,
};
export const WAITER_ACTION_RESULT = {
  ...WAITER_ROW_ACCEPTED,
  events: [{ kind: "arrived", at: "2026-11-20T18:50:00+00:00" }],
  changed: true,
};

/** The detail of an accepted booking on Tavolo 1 and 2, as the seat service reads it first. */
export const SEATABLE_DETAIL = {
  ...ROW_ACCEPTED,
  events: [{ kind: "accepted", at: "2026-11-08T10:05:00+00:00" }],
};
export const SEATED_DETAIL = {
  ...SEATABLE_DETAIL,
  status: "seated",
  sessionId: SESSION_1,
  actions: ["split", "erase"],
};
