import { randomUUID } from "node:crypto";
import { expect, type Page } from "@playwright/test";

// Fixtures of the bill-close and day-close specs (M21 plan §5 step 17), fake data only. Everything the app can do goes through the
// signed-in users' own API calls (`page.request`): the owner sets the coperto and creates the dishes, a waiter opens the table and adds,
// sends and voids the lines. The dishes have no recipe, so sending them takes nothing from stock and the specs need no batches.
// Prices are invented so that the AT2 table totals exactly 100,00 €.

export const CLOSING_NAMES = {
  stew: "Spezzatino con polenta (demo)",
  tagliatelle: "Tagliatelle al ragù (demo)",
  acqua: "Acqua (demo)",
  vino: "Vino rosso (demo)",
} as const;

export interface ClosingMenu {
  stew: string;
  tagliatelle: string;
  acqua: string;
  vino: string;
}

const at = (ms: number) => new Date(Date.now() + ms).toISOString();

async function ok(
  reply: { status(): number; text(): Promise<string> },
  status: number,
  what: string,
) {
  expect(reply.status(), `${what}: ${await reply.text()}`).toBe(status);
}

/** As the signed-in owner: a coperto of 2,00 € at 10 % and the four dishes (14,00 / 12,50 / 3,00 / 40,25). */
export async function seedClosingMenu(owner: Page): Promise<ClosingMenu> {
  await ok(
    await owner.request.patch("/api/settings/coperto", {
      data: { copertoAmount: 2, copertoVatRate: 10 },
    }),
    200,
    "coperto",
  );
  const item = async (name: string, category: string, course: string, price: number) => {
    const made = await owner.request.post("/api/menu/items", {
      data: { name, category, course, recipeKey: null, price, vatRate: 10 },
    });
    await ok(made, 201, name);
    return ((await made.json()) as { item: { id: string } }).item.id;
  };
  return {
    stew: await item(CLOSING_NAMES.stew, "Secondi", "secondi", 14),
    tagliatelle: await item(CLOSING_NAMES.tagliatelle, "Primi", "primi", 12.5),
    acqua: await item(CLOSING_NAMES.acqua, "Bevande", "bevande", 3),
    vino: await item(CLOSING_NAMES.vino, "Bevande", "bevande", 40.25),
  };
}

/** As a waiter: opens the table with the given covers and returns the new session id. */
export async function openSessionAs(
  waiter: Page,
  tableId: string,
  covers: number,
): Promise<string> {
  const sessionId = randomUUID();
  await ok(
    await waiter.request.post(`/api/tables/${tableId}/open`, { data: { sessionId, covers } }),
    201,
    "open table",
  );
  return sessionId;
}

/** As a waiter: adds a dish to a session and returns the line id (the line stays a draft). */
export async function addDishAs(
  waiter: Page,
  sessionId: string,
  menuItemId: string,
  extra: object = {},
): Promise<string> {
  const lineId = randomUUID();
  await ok(
    await waiter.request.post(`/api/table-sessions/${sessionId}/lines`, {
      data: { lineId, menuItemId, clientUpdatedAt: at(-60_000), ...extra },
    }),
    201,
    "add dish",
  );
  return lineId;
}

export async function fireAs(waiter: Page, sessionId: string, lineIds: string[]): Promise<void> {
  await ok(
    await waiter.request.post(`/api/table-sessions/${sessionId}/fire`, { data: { lineIds } }),
    200,
    "fire",
  );
}

/**
 * The AT2 table, all sent: 2 x Spezzatino, 1/2 Spezzatino, 1,5 x Tagliatelle, 1 x Vino (shared) and a Tagliatelle that is sent and then
 * voided (not billed). With the coperto of 2,00 € for 3 covers the bill is 28,00 + 7,00 + 18,75 + 40,25 + 6,00 = 100,00 €.
 */
export async function seedAt2Table(
  waiter: Page,
  tableId: string,
  menu: ClosingMenu,
): Promise<{ sessionId: string; lineIds: string[] }> {
  const sessionId = await openSessionAs(waiter, tableId, 3);
  const lines = [
    await addDishAs(waiter, sessionId, menu.stew, { qty: 2 }),
    await addDishAs(waiter, sessionId, menu.stew, { qty: 0.5 }),
    await addDishAs(waiter, sessionId, menu.tagliatelle, { qty: 1.5 }),
    await addDishAs(waiter, sessionId, menu.vino, { isShared: true }),
  ];
  const voided = await addDishAs(waiter, sessionId, menu.tagliatelle);
  await fireAs(waiter, sessionId, [...lines, voided]);
  await ok(
    await waiter.request.post(`/api/order-lines/${voided}/void`, {
      data: { reason: "order_error", clientUpdatedAt: at(-30_000) },
    }),
    200,
    "void",
  );
  return { sessionId, lineIds: lines };
}

/** As a waiter: a small table of one sent Acqua (3,00 + coperto 2 x 2,00 = 7,00 €). */
export async function seedSmallTable(
  waiter: Page,
  tableId: string,
  menu: ClosingMenu,
): Promise<string> {
  const sessionId = await openSessionAs(waiter, tableId, 2);
  await fireAs(waiter, sessionId, [await addDishAs(waiter, sessionId, menu.acqua)]);
  return sessionId;
}

/** As a waiter: closes a table through the API (the bill is read first for its token). */
export async function closeAs(
  waiter: Page,
  sessionId: string,
  body: {
    receiptType: "scontrino" | "fattura";
    receiptNumber: string | null;
    paymentType: "cash" | "card" | "other";
  },
): Promise<void> {
  const read = await waiter.request.get(`/api/table-sessions/${sessionId}/bill`);
  await ok(read, 200, "bill");
  const token = ((await read.json()) as { billToken: string }).billToken;
  await ok(
    await waiter.request.post(`/api/table-sessions/${sessionId}/close`, {
      data: { ...body, billToken: token },
    }),
    200,
    "close",
  );
}
