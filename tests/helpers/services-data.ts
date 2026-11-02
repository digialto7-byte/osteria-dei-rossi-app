// Fixtures of the M25c service endpoints (fake data only).

export const SERVICE_PERIODS = {
  periods: [
    { key: "pranzo", name: "Pranzo", startsAt: "11:00", endsAt: "16:00" },
    { key: "cena", name: "Cena", startsAt: "16:00", endsAt: "02:00" },
  ],
  cutoff: "02:00",
  since: null as string | null,
  isDefault: true,
};

export const SET_SERVICE_PERIODS = {
  periods: [
    { key: "pranzo", name: "Pranzo", startsAt: "11:00", endsAt: "18:00" },
    { key: "s_0123456789", name: "Aperitivo", startsAt: "18:00", endsAt: "19:30" },
    { key: "cena", name: "Cena", startsAt: "19:30", endsAt: "02:00" },
  ],
  cutoff: "02:00",
  since: "2026-11-05T09:00:00+00:00",
  isDefault: false,
  changed: true,
};

export const SERVICE_SESSION_ID = "14000000-0000-4000-8000-000000000002";

export const SESSION_SERVICE = {
  changed: true,
  session: {
    sessionId: SERVICE_SESSION_ID,
    serviceKey: "pranzo",
    source: "override" as "auto" | "override",
  },
};

/** The day split of plan 3.8 (D = 2026-11-04): T5 at lunch, T1 and T2 at dinner, T4 still open. Fake data only. */
export const DAY_SERVICES = {
  businessDate: "2026-11-04",
  final: false,
  services: [
    {
      key: "pranzo",
      name: "Pranzo",
      position: 1,
      startsAt: "11:00",
      endsAt: "16:00",
      tables: 1,
      covers: 2,
      totalEur: 18,
      revenueNetEur: 16.3637,
      openTables: 0,
    },
    {
      key: "cena",
      name: "Cena",
      position: 2,
      startsAt: "16:00",
      endsAt: "02:00",
      tables: 2,
      covers: 5,
      totalEur: 135,
      revenueNetEur: 119.1281,
      openTables: 1,
    },
  ],
  total: { tables: 3, covers: 7, totalEur: 153, revenueNetEur: 135.4918, openTables: 1 },
  sessions: [
    {
      sessionId: "14000000-0000-4000-8000-000000000009",
      tableName: "Tavolo 5 (demo)",
      openedAt: "2026-11-04T11:30:00+00:00",
      closedAt: "2026-11-04T13:10:00+00:00",
      covers: 2,
      totalEur: 18,
      serviceKey: "pranzo",
      source: "auto" as "auto" | "override",
      choices: ["pranzo", "cena"],
      canChange: true,
    },
    {
      sessionId: SERVICE_SESSION_ID,
      tableName: "Tavolo 2 (demo)",
      openedAt: "2026-11-04T20:30:00+00:00",
      closedAt: "2026-11-04T23:40:00+00:00",
      covers: 2,
      totalEur: 35,
      serviceKey: "cena",
      source: "auto" as "auto" | "override",
      choices: ["pranzo", "cena"],
      canChange: true,
    },
    {
      sessionId: "14000000-0000-4000-8000-000000000004",
      tableName: "Tavolo 4 (demo)",
      openedAt: "2026-11-04T21:00:00+00:00",
      closedAt: null as string | null,
      covers: 4,
      totalEur: null as number | null,
      serviceKey: "cena",
      source: "auto" as "auto" | "override",
      choices: ["pranzo", "cena"],
      canChange: true,
    },
  ],
};
