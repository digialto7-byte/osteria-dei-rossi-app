// Fixtures of the reservation endpoints (fake data only: "Cliente Demo", "Tavolo 1 (demo)", example.com addresses).

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
  notReady: ["slug", "privacy_name", "privacy_email"],
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
