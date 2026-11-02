import { expect, test } from "@playwright/test";
import { newContext } from "./helpers/order-ui";
import { closeAs, seedAt2Table, seedClosingMenu, seedSmallTable } from "./helpers/seed-closing";
import { createWaiter, seedTables, WAITER_A } from "./helpers/seed-menu-tables";
import { tenantIdOf } from "./helpers/seed-invoice";
import { businessDateOf, DEFAULT_SERVICES, dayServices, setServices } from "./helpers/services";
import {
  createOwner,
  createStaff,
  expectPhoneFriendly,
  requireSupabaseStack,
  signInWithMagicLink,
} from "./helpers/session";

requireSupabaseStack();

// M25c on a phone (360 x 740), Chromium only (plan §5 step 17). Fake data only.
//   Test 1  the owner adds "Aperitivo" at 18:00 on /tavoli/impostazioni; a reload keeps it; the default hours come back afterwards
//   Test 2  on /chiusura the owner moves a closed table to the other service: the row says "Spostato", the day total does not change, the API agrees;
//           the chef gets 403 on the split
// Headings are named exactly and scoped to main, rows are found by data attributes inside the card, links and buttons by their real text. Tables open at
// the wall-clock time, so nothing here expects a time-derived key: the key of the table is read from the API and the table is moved to the other one.

test.describe.configure({ mode: "serial" });

const main = (page: import("@playwright/test").Page) => page.locator("main");

test.describe("the services on a phone (360 px)", () => {
  test.setTimeout(300_000);

  test("the owner adds Aperitivo at 18:00 and a reload keeps it (settings)", async ({ page }) => {
    await signInWithMagicLink(page, createOwner(), "/");
    await page.goto("/tavoli/impostazioni");
    await expect(main(page).getByRole("heading", { name: "Servizi", exact: true })).toBeVisible();
    await expect(main(page).getByText("Orari predefiniti", { exact: true })).toBeVisible();

    const card = main(page).getByRole("group", { name: "Servizi", exact: true });
    await card.getByRole("button", { name: "Aggiungi servizio", exact: true }).click();
    await card.getByLabel("Nome del servizio 3", { exact: true }).fill("Aperitivo");
    await card.getByLabel("Inizio del servizio 3", { exact: true }).fill("18:00");
    await card.getByRole("button", { name: "Salva servizi", exact: true }).click();
    await expect(main(page).getByRole("status")).toHaveText("Salvato.");
    await expect(card.locator("[data-services-preview]")).toContainText("Aperitivo 18:00–");
    await expectPhoneFriendly(page);

    await page.reload();
    const again = main(page).getByRole("group", { name: "Servizi", exact: true });
    await expect(again.locator("[data-services-preview]")).toContainText("Aperitivo 18:00–");
    await expect(again.getByLabel("Nome del servizio 3", { exact: true })).toHaveValue("Aperitivo");
    await expect(again.getByText("Orari predefiniti", { exact: true })).toHaveCount(0);

    // Back to the two default services (the saved versions stay: the schedule is append-only).
    await setServices(page, DEFAULT_SERVICES);
    await page.reload();
    await expect(
      main(page)
        .getByRole("group", { name: "Servizi", exact: true })
        .locator("[data-services-preview]"),
    ).toContainText("Pranzo 11:00–16:00");
  });

  test("the owner moves a closed table to the other service; the total does not move; the chef is refused (day close)", async ({
    page,
    browser,
  }, testInfo) => {
    const ownerEmail = createOwner();
    await signInWithMagicLink(page, ownerEmail, "/");
    const tenantId = await tenantIdOf(page);
    const menu = await seedClosingMenu(page);
    const tables = await seedTables(page, ["Tavolo 1 (demo)", "Tavolo 2 (demo)"]);

    const waiter = await newContext(browser, testInfo.project.use);
    await signInWithMagicLink(waiter.page, await createWaiter(tenantId, WAITER_A), "/tavoli");
    const first = await seedAt2Table(waiter.page, tables["Tavolo 1 (demo)"]!, menu);
    const second = await seedSmallTable(waiter.page, tables["Tavolo 2 (demo)"]!, menu);
    await closeAs(waiter.page, first.sessionId, {
      receiptType: "scontrino",
      receiptNumber: "0001",
      paymentType: "card",
    });
    await closeAs(waiter.page, second, {
      receiptType: "scontrino",
      receiptNumber: "0002",
      paymentType: "cash",
    });

    const day = await businessDateOf(page);
    const before = await dayServices(page, day);
    const current = before.sessions.find((s) => s.sessionId === first.sessionId)!;
    const targetKey = current.choices.find((key) => key !== current.serviceKey)!;
    const targetName = before.services.find((s) => s.key === targetKey)!.name;

    await page.goto("/chiusura");
    await expect(
      main(page).getByRole("heading", { name: "Per servizio", exact: true }),
    ).toBeVisible();
    const card = main(page).getByRole("group", { name: "Per servizio", exact: true });
    const totalBefore = await card.getByText(/^Totale giorno/).innerText();
    await card.getByRole("button", { name: "Tavoli per servizio", exact: true }).click();
    const row = card.locator(`[data-session-id="${first.sessionId}"]`);
    await expect(row).toBeVisible();
    await expect(row).not.toContainText("Spostato");

    await row.getByRole("button", { name: /Cambia servizio/ }).click();
    const sheet = main(page).getByRole("group", { name: /^Cambia servizio ·/ });
    await sheet.getByRole("radio", { name: targetName, exact: true }).check();
    await expectPhoneFriendly(page);
    await sheet.getByRole("button", { name: "Conferma", exact: true }).click();

    await expect(row).toContainText("Spostato");
    await expect(card.getByText(/^Totale giorno/)).toHaveText(totalBefore);
    const after = await dayServices(page, day);
    const moved = after.sessions.find((s) => s.sessionId === first.sessionId)!;
    expect(moved.serviceKey).toBe(targetKey);
    expect(moved.source).toBe("override");
    expect(after.total).toEqual(before.total);

    // The chef (a second context; a different address, so no wait for the link) reads no split.
    const chef = await newContext(browser, testInfo.project.use);
    await signInWithMagicLink(chef.page, await createStaff(tenantId, "chef"), "/");
    expect((await chef.page.request.get("/api/day-close/services")).status()).toBe(403);
  });
});
