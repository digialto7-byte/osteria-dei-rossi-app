import { expect, test, type Page } from "@playwright/test";
import { businessDateOf } from "./helpers/business-date";
import { main, newContext } from "./helpers/order-ui";
import { tenantIdOf } from "./helpers/seed-invoice";
import { createWaiter, WAITER_A } from "./helpers/seed-menu-tables";
import {
  createOwner,
  createStaff,
  expectPhoneFriendly,
  requireSupabaseStack,
  signInWithMagicLink,
} from "./helpers/session";
import { seedTraceE2e, sellOne, TRACE_E2E, type TraceE2eSeed } from "./helpers/trace";

requireSupabaseStack();

// P2-2 "Com'è andata" on Da spingere, on a phone (360 x 740), Chromium only (`phone`). The tenant is seeded through the real API in a beforeAll: an approved
// invoice, a ragù batch with a shelf life of 20 hours (so it is due within a day when the push starts) and the plate "Lasagne Demo" on it. The owner pushes the
// plate from the sheet at 10,00 €, a waiter sends one plate, and "Com'è andata" shows the day (today, in progress) with one plate sold, the batch that was due
// soon and the day price; the chef reads the same counts with no price. The server clock cannot be moved here, so the day is today. Every seeded date comes from
// the business date (02:00 cut-off) and the last test reads it again. Fake data only.
//   AT-P6 sell-through for the day, the owner's price, the chef's reply with none   AT-P11 the business date

test.describe.configure({ mode: "serial" });
test.setTimeout(300_000);

let fixture: { email: string; tenantId: string; seed: TraceE2eSeed } | null = null;

function seeded() {
  if (!fixture) throw new Error("The beforeAll seeding did not run");
  return fixture;
}

test.beforeAll(async ({ browser }, testInfo) => {
  const { context, page } = await newContext(browser, testInfo.project.use);
  try {
    const email = createOwner();
    await signInWithMagicLink(page, email, "/");
    const tenantId = await tenantIdOf(page);
    fixture = { email, tenantId, seed: await seedTraceE2e(page, tenantId, 20) };
  } finally {
    await context.close();
  }
});

const batchRow = (page: Page) =>
  main(page).locator(`[data-push-row-id="${seeded().seed.batchId}"]`);
const panel = (page: Page) => main(page).getByRole("region", { name: "Com'è andata" });

test.describe("the owner", () => {
  test("pushes the plate at 10,00 € from the sheet", async ({ page }) => {
    await signInWithMagicLink(page, seeded().email);
    await page.goto("/spingere");
    const row = batchRow(page);
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: /^Spingi oggi/ }).click();
    const sheet = main(page).getByRole("group", { name: TRACE_E2E.plate });
    await expect(sheet).toContainText(/Prezzo del menu: 12,00\s+€/);
    await sheet.getByRole("textbox", { name: /^Prezzo del giorno/ }).fill("10,00");
    await sheet.getByRole("button", { name: "Conferma", exact: true }).click();
    await expect(row).toContainText(/In evidenza fino alle\s+\d{2}:\d{2}\s+·\s+10,00\s+€/);
  });
});

test.describe("a waiter", () => {
  test("sends one plate of the pushed dish", async ({ browser }, testInfo) => {
    const { tenantId, seed } = seeded();
    const waiter = await newContext(browser, testInfo.project.use);
    try {
      await signInWithMagicLink(waiter.page, await createWaiter(tenantId, WAITER_A), "/tavoli");
      await sellOne(waiter.page, seed.tableIds[0]!, seed.itemId);
    } finally {
      await waiter.context.close();
    }
  });
});

test.describe("Com'è andata", () => {
  test("the owner reads yesterday (nothing pushed) and today (in progress, one plate sold, the day price)", async ({
    page,
  }) => {
    const { email, seed } = seeded();
    await signInWithMagicLink(page, email);
    await page.goto("/spingere");
    // With no date the day is yesterday, when nothing was pushed.
    await expect(panel(page)).toContainText("Nessun piatto messo in evidenza in questo giorno.");

    await panel(page).getByLabel("Giorno", { exact: true }).fill(seed.day);
    await expect(panel(page)).toContainText("Oggi (in corso)");
    await expect(panel(page)).toContainText(TRACE_E2E.plate);
    await expect(panel(page)).toContainText("1 piatto venduto");
    await expect(panel(page)).toContainText(/Prezzo del giorno\s+10,00\s+€/);
    // The batch was due within 24 hours when the push started: its ten portions, and the one that was sold.
    await expect(panel(page)).toContainText(TRACE_E2E.batchRecipe);
    await expect(panel(page)).toContainText("10 porzioni in scadenza all'avvio");
    await expect(panel(page)).toContainText("1 venduta (10%)");
    await expect(panel(page)).toContainText(
      "Le porzioni vendute includono altri piatti con lo stesso preparato.",
    );
    await expectPhoneFriendly(page);
  });

  test("the chef reads the same counts with no day price and no euro", async ({ page }) => {
    const { tenantId, seed } = seeded();
    await signInWithMagicLink(page, await createStaff(tenantId, "chef"));
    await page.goto("/spingere");
    await expect(panel(page)).toContainText("Nessun piatto messo in evidenza in questo giorno.");
    await panel(page).getByLabel("Giorno", { exact: true }).fill(seed.day);
    await expect(panel(page)).toContainText("Oggi (in corso)");
    await expect(panel(page)).toContainText("1 piatto venduto");
    await expect(panel(page)).not.toContainText("Prezzo del giorno");
    expect(await panel(page).innerText()).not.toContain("€");
    const reply = await page.request.get(`/api/reports/push-sell-through?date=${seed.day}`);
    expect(reply.status()).toBe(200);
    expect(await reply.text()).not.toContain("pushPrice");
    await expectPhoneFriendly(page);
  });
});

test.describe("the run", () => {
  test("did not cross the 02:00 cut-off", async ({ page }) => {
    await signInWithMagicLink(page, seeded().email);
    expect(await businessDateOf(page), "the run crossed the 02:00 cut-off").toBe(seeded().seed.day);
  });
});
