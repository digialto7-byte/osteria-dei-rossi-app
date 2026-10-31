import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import type { AddLineOutput, FireOutput } from "@/server/orders/output";
import { createUser, type Stack, type TestTenant, type TestUser } from "./stack";

// Fixtures of the bill and close suite (M21 plan §5 step 13), fake data only. Everything the app can do goes through the routes: the
// coperto setting, the menu items, the tables, the lines (added, fired and voided). Prices are invented so that the AT2 table totals
// exactly 100,00 €. The four dishes are unmapped (no recipe), so firing them depletes no stock and the suite needs no batches.
// The secret key creates the second waiter only.

export const CLOSING_NAMES = {
  stew: "Spezzatino con polenta (demo)",
  tagliatelle: "Tagliatelle al ragù (demo)",
  acqua: "Acqua (demo)",
  vino: "Vino rosso (demo)",
} as const;

export const CLOSING_PRICES = { stew: 14, tagliatelle: 12.5, acqua: 3, vino: 40.25 } as const;

export interface ClosingCalls {
  /** POST /api/menu/items as the owner. */
  createItem: (body: object) => Promise<{ status: number; body: { item: { id: string } } }>;
  /** PATCH /api/settings/coperto as the owner. */
  setCoperto: (body: object) => Promise<{ status: number }>;
  /** POST /api/dining-tables as the owner. */
  createTable: (name: string, position: number) => Promise<{ status: number; tableId: string }>;
  /** POST /api/tables/:id/open as the waiter. */
  openTable: (
    user: TestUser,
    tableId: string,
    sessionId: string,
    covers: number,
  ) => Promise<{ status: number }>;
  /** POST /api/table-sessions/:id/lines. */
  addLine: (
    user: TestUser,
    session: string,
    body: object,
  ) => Promise<{ status: number; body: AddLineOutput }>;
  /** POST /api/table-sessions/:id/fire. */
  fire: (
    user: TestUser,
    session: string,
    lineIds: string[],
  ) => Promise<{ status: number; body: FireOutput }>;
  /** POST /api/order-lines/:id/void. */
  voidLine: (user: TestUser, id: string, body: object) => Promise<{ status: number }>;
}

export interface ClosingFixture {
  waiter2: TestUser;
  items: { stew: string; tagliatelle: string; acqua: string; vino: string };
}

const at = (ms: number) => new Date(Date.now() + ms).toISOString();

/** A second waiter, the four menu items and a coperto of 2,00 € at 10 %. */
export async function seedClosingTenant(
  stack: Stack,
  tenant: TestTenant,
  calls: ClosingCalls,
): Promise<ClosingFixture> {
  const coperto = await calls.setCoperto({ copertoAmount: 2, copertoVatRate: 10 });
  expect(coperto.status).toBe(200);
  const item = async (name: string, category: string, course: string, price: number) => {
    const made = await calls.createItem({
      name,
      category,
      course,
      recipeKey: null,
      price,
      vatRate: 10,
    });
    expect(made.status).toBe(201);
    return made.body.item.id;
  };
  return {
    waiter2: await createUser(stack.env, stack.admin, tenant.id, "waiter", "Cameriere Due Demo"),
    items: {
      stew: await item(CLOSING_NAMES.stew, "Secondi", "secondi", CLOSING_PRICES.stew),
      tagliatelle: await item(
        CLOSING_NAMES.tagliatelle,
        "Primi",
        "primi",
        CLOSING_PRICES.tagliatelle,
      ),
      acqua: await item(CLOSING_NAMES.acqua, "Bevande", "bevande", CLOSING_PRICES.acqua),
      vino: await item(CLOSING_NAMES.vino, "Bevande", "bevande", CLOSING_PRICES.vino),
    },
  };
}

/** A table and an open session on it, opened by the given waiter. */
export async function openSession(
  calls: ClosingCalls,
  waiter: TestUser,
  name: string,
  position: number,
  covers: number,
): Promise<{ tableId: string; sessionId: string }> {
  const table = await calls.createTable(name, position);
  expect(table.status).toBe(201);
  const sessionId = randomUUID();
  const opened = await calls.openTable(waiter, table.tableId, sessionId, covers);
  expect(opened.status).toBe(201);
  return { tableId: table.tableId, sessionId };
}

/** Adds a dish and returns the line id (the line stays a draft). */
export async function addDish(
  calls: ClosingCalls,
  user: TestUser,
  session: string,
  menuItemId: string,
  extra: object = {},
): Promise<string> {
  const added = await calls.addLine(user, session, {
    lineId: randomUUID(),
    menuItemId,
    clientUpdatedAt: at(-60_000),
    ...extra,
  });
  expect(added.status).toBe(201);
  return added.body.line.id;
}

export interface At2Lines {
  stew2: string;
  stewHalf: string;
  tagliatelle15: string;
  vino: string;
  voided: string;
}

/**
 * The AT2 table (3 covers, coperto 2,00): 2 x Spezzatino, 1/2 Spezzatino, 1,5 x Tagliatelle, 1 x Vino (shared), and one Tagliatelle that
 * is sent and then voided (not billed). Everything is fired. Total 28,00 + 7,00 + 18,75 + 40,25 + 6,00 = 100,00 €.
 */
export async function buildAt2Table(
  calls: ClosingCalls,
  waiter: TestUser,
  session: string,
  fixture: ClosingFixture,
): Promise<At2Lines> {
  const { items } = fixture;
  const stew2 = await addDish(calls, waiter, session, items.stew, { qty: 2 });
  const stewHalf = await addDish(calls, waiter, session, items.stew, { qty: 0.5 });
  const tagliatelle15 = await addDish(calls, waiter, session, items.tagliatelle, { qty: 1.5 });
  const vino = await addDish(calls, waiter, session, items.vino, { isShared: true });
  const voided = await addDish(calls, waiter, session, items.tagliatelle);
  const fired = await calls.fire(waiter, session, [stew2, stewHalf, tagliatelle15, vino, voided]);
  expect(fired.status).toBe(200);
  const gone = await calls.voidLine(waiter, voided, {
    reason: "order_error",
    clientUpdatedAt: at(-30_000),
  });
  expect(gone.status).toBe(200);
  return { stew2, stewHalf, tagliatelle15, vino, voided };
}
