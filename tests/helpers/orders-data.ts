// Fake data for the M18 tests (order entry). Every name, id, price and instant is invented.
import type { AddLineOutput, OrderLine, OrderView } from "@/server/orders/output";

export const OIDS = {
  item: "3e000000-0000-4000-8000-000000000001",
  item2: "3e000000-0000-4000-8000-000000000002",
  item3: "3e000000-0000-4000-8000-000000000003",
  session: "5e000000-0000-4000-8000-000000000001",
  table: "7a000000-0000-4000-8000-000000000001",
  line1: "10000000-0000-4000-8000-000000000001",
  line2: "10000000-0000-4000-8000-000000000002",
  line3: "10000000-0000-4000-8000-000000000003",
  waiterA: "a0000000-0000-4000-8000-000000000001",
  waiterB: "a0000000-0000-4000-8000-000000000002",
};

export const STEW = "Spezzatino con polenta (demo)";

export const LINE_STEW: OrderLine = {
  id: OIDS.line1,
  menuItemId: OIDS.item,
  name: STEW,
  course: "secondi",
  qty: 2,
  segue: false,
  note: null,
  isShared: false,
  unitPrice: 14,
  state: "draft",
  clientUpdatedAt: "2026-11-02T19:30:00.123+00:00",
  updatedAt: "2026-11-02T19:30:01.123456+00:00",
  updatedBy: { id: OIDS.waiterA, displayName: "Cameriere Demo" },
};

export const LINE_SOUP: OrderLine = {
  ...LINE_STEW,
  id: OIDS.line2,
  menuItemId: OIDS.item2,
  name: "Zuppa del giorno (demo)",
  course: "primi",
  qty: 0.5,
  isShared: true,
  segue: true,
  note: "senza cipolla",
  unitPrice: 9,
};

export const ORDER_VIEW: OrderView = {
  session: {
    id: OIDS.session,
    tableId: OIDS.table,
    tableName: "Tavolo 1 (demo)",
    covers: 4,
    status: "open",
    billRequested: false,
    closed: false,
  },
  lines: [LINE_SOUP, LINE_STEW],
};

export const ADD_REPLY: AddLineOutput = {
  created: true,
  line: LINE_STEW,
  item: { id: OIDS.item, available: true, portionsLeft: 3, lowStock: true },
};
