import {
  expect,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
  type TestInfo,
} from "@playwright/test";
import { COMANDA_URL, lineIds, nextSync, sessionIdOf } from "./offline";

// The order screen as a waiter drives it (shared by the M19 specs; the M18 spec keeps its own copies).

export const main = (page: Page) => page.locator("main");
export const tab = (page: Page, course: RegExp) => page.getByRole("tab", { name: course });
export const bar = (page: Page) => page.getByRole("button", { name: /^Comanda/ });
/** The menu button of a dish in the course panel (the pinned strip repeats a pushed dish, marked data-pinned). */
export const dish = (page: Page, id: string) =>
  page.locator(`[data-menu-item-id="${id}"]:not([data-pinned])`);
export const lineRow = (page: Page, id: string) => page.locator(`[data-line-id="${id}"]`);

/**
 * Unfolds the sent lines of one course on the comanda (Direct comanda: they fold to one row, "Primi · 3 inviati"). The row exists only
 * once the course has a sent line, so the call waits for it; unfolding twice is harmless. `course` is the course's name as shown ("Primi").
 */
export async function unfoldSent(page: Page, course: string): Promise<void> {
  const fold = page.getByRole("button", { name: new RegExp(`^${course} · \\d+ inviat`) });
  await expect(fold).toBeVisible();
  if ((await fold.getAttribute("aria-expanded")) === "false") await fold.click();
  await expect(fold).toHaveAttribute("aria-expanded", "true");
}

/** A new browser context in the project's own browser and size: an independent session. */
export async function newContext(browser: Browser, use: TestInfo["project"]["use"]) {
  const context = await browser.newContext({ ...use, baseURL: use.baseURL });
  return { context, page: await context.newPage() };
}

/**
 * Closes browser contexts in reverse order of creation. A spec that opens a context next to the test's own must not close it in the middle
 * of the test: closing one context while another of the same browser is still in use crashed Chromium's headless shell (runs 43682851653
 * and 43696251007). Register the extra contexts as they open and close them from
 * `test.afterEach(({}, testInfo) => closeContexts(opened, testInfo))`; the list is emptied, so the next test starts clean.
 * tests/guards/e2e-context-teardown.test.ts keeps mid-test closes out.
 *
 * Diagnostics: afterEach runs before Playwright's fixture teardown, and Playwright 1.56.1 writes error-context.md (the page snapshot the CI
 * step "Page snapshots of the failed tests" prints) from the first context closed after a failure. So after a failed test that file may show
 * an extra context's page, not the default `page`. To keep the failing pages readable, when the test did not end as expected each open
 * page's aria snapshot is attached and printed to the log (fake CI data only) before any context is closed.
 */
export async function closeContexts(opened: BrowserContext[], testInfo: TestInfo): Promise<void> {
  const contexts = opened.splice(0).reverse();
  if (testInfo.status !== testInfo.expectedStatus) {
    for (const [c, context] of contexts.entries()) {
      for (const [p, page] of context.pages().entries()) {
        const name = `extra-context-${c + 1}-page-${p + 1}-aria-snapshot`;
        const body = await page
          .locator("body")
          .ariaSnapshot({ timeout: 3_000 })
          .catch((error: Error) => `no snapshot: ${error.message}`);
        await testInfo.attach(name, { body, contentType: "text/plain" });
        console.log(
          `[${testInfo.title}] ${name} (${new URL(page.url(), "http://x").pathname})\n${body}`,
        );
      }
    }
  }
  for (const context of contexts) await context.close();
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

/**
 * The waiter opens the table from the tables grid (4 covers unless the caller says otherwise) and lands on its order (B8: one step);
 * returns the session id.
 */
export async function openTableAndOrder(page: Page, tableId: string, covers = 4): Promise<string> {
  await page.goto("/tavoli");
  const tile = page.locator(`[data-table-id="${tableId}"]`);
  await tile.click();
  await page.getByLabel("Coperti", { exact: true }).fill(String(covers));
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
