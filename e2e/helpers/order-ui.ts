import {
  expect,
  type Browser,
  type Locator,
  type Page,
  type Response,
  type TestInfo,
} from "@playwright/test";

// The order screen as a waiter drives it (shared by the M19 specs; the M18 spec keeps its own copies).

export const main = (page: Page) => page.locator("main");
export const tab = (page: Page, course: RegExp) => page.getByRole("tab", { name: course });
export const bar = (page: Page) => page.getByRole("button", { name: /^Comanda/ });
/** The menu button of a dish in the course panel (the pinned strip repeats a pushed dish, marked data-pinned). */
export const dish = (page: Page, id: string) =>
  page.locator(`[data-menu-item-id="${id}"]:not([data-pinned])`);
export const lineRow = (page: Page, id: string) => page.locator(`[data-line-id="${id}"]`);

/** A new browser context in the project's own browser and size: an independent session. */
export async function newContext(browser: Browser, use: TestInfo["project"]["use"]) {
  const context = await browser.newContext({ ...use, baseURL: use.baseURL });
  return { context, page: await context.newPage() };
}

const isLinesPost = (sessionId: string) => (r: Response) =>
  new URL(r.url()).pathname === `/api/table-sessions/${sessionId}/lines` &&
  r.request().method() === "POST";

/** Taps a dish and returns the id of the line the server created (the POST answers 201). */
export async function tapDish(page: Page, sessionId: string, button: Locator): Promise<string> {
  const [response] = await Promise.all([
    page.waitForResponse(isLinesPost(sessionId)),
    button.click(),
  ]);
  expect(response.status()).toBe(201);
  return ((await response.json()) as { line: { id: string } }).line.id;
}

/** The waiter opens the table (4 covers) from the tables grid and lands on its order (B8: one step); returns the session id. */
export async function openTableAndOrder(page: Page, tableId: string): Promise<string> {
  await page.goto("/tavoli");
  const tile = page.locator(`[data-table-id="${tableId}"]`);
  await tile.click();
  await page.getByLabel("Coperti", { exact: true }).fill("4");
  const [opened] = await Promise.all([
    page.waitForResponse(
      (r) => /\/api\/tables\/[^/]+\/open$/.test(r.url()) && r.request().method() === "POST",
    ),
    page.getByRole("button", { name: "Apri tavolo", exact: true }).click(),
  ]);
  expect(opened.status()).toBe(201);
  // B8: opening the table leads straight to its comanda, at /tavoli/<the session id the dialog made>.
  await page.waitForURL(/\/tavoli\/[0-9a-f-]{36}$/);
  return new URL(page.url()).pathname.split("/").pop()!;
}

/** Presses a send button (found by its accessible name) and returns the reply of POST …/fire. */
export async function send(page: Page, sessionId: string, name: string) {
  const [response] = await Promise.all([
    page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === `/api/table-sessions/${sessionId}/fire` &&
        r.request().method() === "POST",
    ),
    page.getByRole("button", { name, exact: true }).click(),
  ]);
  expect(response.status()).toBe(200);
  return (await response.json()) as {
    fired: string[];
    skipped: { lineId: string; reason: string }[];
  };
}
