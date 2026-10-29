import { expect, type Browser, type Locator, type Page, type TestInfo } from "@playwright/test";
import { COMANDA_URL, lineIds, nextSync, sessionIdOf } from "./offline";

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

/**
 * Taps a dish and returns the id of the line it made. The line is created on the phone (M20: a queued operation), so the id
 * comes from the sheet; the call waits for the replay to carry it to the server and for the "In coda" mark to go.
 */
export async function tapDish(page: Page, _sessionId: string, button: Locator): Promise<string> {
  const before = new Set(await lineIds(page));
  const [response] = await Promise.all([nextSync(page), button.click()]);
  expect(response.status()).toBe(200);
  const made = (
    (await response.json()) as {
      results: { kind: string; status: string; reply?: { line?: { id: string } } }[];
    }
  ).results.find((result) => result.kind === "add_line");
  expect(made?.status).toBe("applied");
  const id = made!.reply!.line!.id;
  expect(before.has(id)).toBe(false);
  return id;
}

/** The waiter opens the table (4 covers) from the tables grid and lands on its order (B8: one step); returns the session id. */
export async function openTableAndOrder(page: Page, tableId: string): Promise<string> {
  await page.goto("/tavoli");
  const tile = page.locator(`[data-table-id="${tableId}"]`);
  await tile.click();
  await page.getByLabel("Coperti", { exact: true }).fill("4");
  const [opened] = await Promise.all([
    nextSync(page),
    page.getByRole("button", { name: "Apri tavolo", exact: true }).click(),
  ]);
  const reply = (await opened.json()) as { results: { kind: string; status: string }[] };
  expect(reply.results.find((result) => result.kind === "open_table")?.status).toBe("applied");
  // B8: opening the table leads straight to its comanda, at /tavoli/comanda?s=<the session id the dialog made>.
  await page.waitForURL(COMANDA_URL);
  return sessionIdOf(page.url());
}

/** Presses a send button (found by its accessible name) and returns what the server decided for the fire. */
export async function send(page: Page, _sessionId: string, name: string) {
  const [response] = await Promise.all([
    nextSync(page),
    page.getByRole("button", { name, exact: true }).click(),
  ]);
  expect(response.status()).toBe(200);
  const body = (await response.json()) as {
    results: {
      kind: string;
      status: string;
      reply?: { fired: string[]; skipped: { lineId: string; reason: string }[] };
    }[];
  };
  const fire = body.results.find((result) => result.kind === "fire");
  expect(fire?.status).toBe("applied");
  return fire!.reply!;
}
