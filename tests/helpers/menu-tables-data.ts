// Fake data for the M17 tests (menu, tables, sessions, coperto). Every name, id and price is invented.
import type { ManageMenu, MenuItem, ServiceMenu } from "@/server/menu/output";
import type { CopertoRead, DiningTable, TableSession, TablesList } from "@/server/tables/output";

export const IDS = {
  item: "3e000000-0000-4000-8000-000000000001",
  item2: "3e000000-0000-4000-8000-000000000002",
  recipeKey: "ec000000-0000-4000-8000-0000000000e1",
  table1: "7a000000-0000-4000-8000-000000000001",
  table2: "7a000000-0000-4000-8000-000000000002",
  table3: "7a000000-0000-4000-8000-000000000003",
  session1: "5e000000-0000-4000-8000-000000000001",
  session2: "5e000000-0000-4000-8000-000000000002",
  waiterA: "a0000000-0000-4000-8000-000000000001",
  waiterB: "a0000000-0000-4000-8000-000000000002",
};

export const COPERTO = { perPerson: 1.5, vatRate: 10, total: 6 };

export const MAPPED_ITEM: MenuItem = {
  id: IDS.item,
  name: "Spezzatino con polenta (demo)",
  category: "Secondi",
  course: "secondi",
  position: 0,
  recipeKey: IDS.recipeKey,
  recipeName: "Spezzatino con polenta (demo)",
  recipeActive: true,
  unmapped: false,
  price: 14,
  vatRate: 10,
  priceValidFrom: "2026-11-02T10:00:00.123456+00:00",
  available: true,
  active: true,
  pushUntil: null,
  pushPrice: null,
};

export const UNMAPPED_ITEM: MenuItem = {
  ...MAPPED_ITEM,
  id: IDS.item2,
  name: "Acqua (demo)",
  category: "Bevande",
  course: "bevande",
  position: 1,
  recipeKey: null,
  recipeName: null,
  recipeActive: null,
  unmapped: true,
  price: 2,
};

export const SERVICE_MENU: ServiceMenu = {
  categories: [
    {
      name: "Secondi",
      items: [
        {
          id: IDS.item,
          name: MAPPED_ITEM.name,
          category: "Secondi",
          course: "secondi",
          price: 14,
          available: true,
          pushed: false,
          pushPrice: null,
        },
      ],
    },
    {
      name: "Bevande",
      items: [
        {
          id: IDS.item2,
          name: UNMAPPED_ITEM.name,
          category: "Bevande",
          course: "bevande",
          price: 2,
          available: true,
          pushed: false,
          pushPrice: null,
        },
      ],
    },
  ],
};

export const MANAGE_MENU: ManageMenu = {
  defaults: { vatRate: 10 },
  vatRates: [0, 4, 5, 10, 22],
  courses: ["antipasti", "primi", "secondi", "dolci", "bevande"],
  categories: ["Bevande", "Secondi"],
  items: [MAPPED_ITEM, UNMAPPED_ITEM],
};

export const SESSION: TableSession = {
  id: IDS.session1,
  tableId: IDS.table1,
  tableName: "Tavolo 1 (demo)",
  covers: 4,
  openedAt: "2026-11-02T19:15:00.123456+00:00",
  businessDate: "2026-11-02",
  waiter: { id: IDS.waiterA, displayName: "Cameriere Demo" },
  billRequested: false,
  coperto: COPERTO,
};

export const TABLES_LIST: TablesList = {
  businessDate: "2026-11-02",
  tables: [
    {
      id: IDS.table1,
      name: "Tavolo 1 (demo)",
      position: 1,
      status: "open",
      session: {
        id: IDS.session1,
        covers: 4,
        openedAt: "2026-11-02T19:15:00+00:00",
        openedToday: true,
        waiter: { id: IDS.waiterA, displayName: "Cameriere Demo" },
        billRequested: false,
        coperto: COPERTO,
      },
    },
    { id: IDS.table2, name: "Tavolo 2 (demo)", position: 2, status: "free", session: null },
    {
      id: IDS.table3,
      name: "Tavolo 3 (demo)",
      position: 3,
      status: "bill_requested",
      session: {
        id: IDS.session2,
        covers: 2,
        openedAt: "2026-11-02T18:00:00+00:00",
        openedToday: true,
        waiter: { id: IDS.waiterB, displayName: "Cameriere Due Demo" },
        billRequested: true,
        coperto: null,
      },
    },
  ],
};

export const DINING_TABLES: DiningTable[] = [
  { id: IDS.table1, name: "Tavolo 1 (demo)", position: 1, active: true, open: true },
  { id: IDS.table2, name: "Tavolo 2 (demo)", position: 2, active: true, open: false },
];

export const COPERTO_READ: CopertoRead = {
  coperto: { amount: 1.5, vatRate: 10 },
  defaults: { vatRate: 10 },
  vatRates: [0, 4, 5, 10, 22],
};
