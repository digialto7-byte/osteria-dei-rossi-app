// Fake data for the M19 kitchen tests. Every name, id and instant is invented.
import type { KitchenTickets } from "@/server/kitchen/output";

export const KIDS = {
  session: "5e000000-0000-4000-8000-000000000001",
  session2: "5e000000-0000-4000-8000-000000000002",
  line1: "10000000-0000-4000-8000-000000000001",
  line2: "10000000-0000-4000-8000-000000000002",
  line3: "10000000-0000-4000-8000-000000000003",
  waiterA: "a0000000-0000-4000-8000-000000000001",
  waiterB: "a0000000-0000-4000-8000-000000000002",
};

export const KITCHEN_TICKETS: KitchenTickets = {
  asOf: "2026-11-04T19:31:30.000000+00:00",
  truncated: false,
  tickets: [
    {
      key: `${KIDS.session}|2026-11-04T19:31:00.000000Z|secondi|false`,
      sessionId: KIDS.session,
      tableName: "Tavolo 1 (demo)",
      covers: 4,
      course: "secondi",
      segue: false,
      firedAt: "2026-11-04T19:31:00.000000Z",
      firedBy: { id: KIDS.waiterA, displayName: "Cameriere Demo" },
      lines: [
        {
          id: KIDS.line1,
          name: "Spezzatino con polenta (demo)",
          qty: 2,
          note: "senza cipolla",
          isShared: false,
          voided: false,
          voidReason: null,
        },
        {
          id: KIDS.line2,
          name: "Zuppa del giorno (demo)",
          qty: 0.5,
          note: null,
          isShared: true,
          voided: true,
          voidReason: "kitchen_error",
        },
      ],
    },
    {
      key: `${KIDS.session2}|2026-11-04T19:40:00.000000Z|primi|true`,
      sessionId: KIDS.session2,
      tableName: "Tavolo 2 (demo)",
      covers: 2,
      course: "primi",
      segue: true,
      firedAt: "2026-11-04T19:40:00.000000Z",
      firedBy: { id: KIDS.waiterB, displayName: "Cameriere Due Demo" },
      lines: [
        {
          id: KIDS.line3,
          name: "Tagliatelle al ragù (demo)",
          qty: 1,
          note: null,
          isShared: false,
          voided: false,
          voidReason: null,
        },
      ],
    },
  ],
};
