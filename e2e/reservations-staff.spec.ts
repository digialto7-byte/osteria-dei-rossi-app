import { expect, test, type Browser, type Page } from "@playwright/test";
import { COMANDA_URL } from "./helpers/offline";
import {
  bookingToday,
  CUSTOMER,
  reservationIdOf,
  rowTitleOf,
  seedCustomerRequest,
  tomorrowOf,
} from "./helpers/reservations";
import { tenantIdOf } from "./helpers/seed-invoice";
import { seedTables } from "./helpers/seed-menu-tables";
import { businessDateOf } from "./helpers/services";
import {
  createOwner,
  createStaff,
  expectPhoneFriendly,
  requireSupabaseStack,
  signInWithMagicLink,
} from "./helpers/session";

requireSupabaseStack();

// Reservations, the staff side, on a phone (360 x 740), lean (plan A15). The owner sets the bookable tables and a group on "Tavoli · impostazioni"; a seeded customer
// request appears on /prenotazioni and "Accetta" with the suggestion makes it "Confermata" on the smallest table that fits; a waiter (a second context, so a second
// real session) opens that table from the booking and lands on its comanda; the chef is refused by the API. Fake data only ("(demo)" names, example.com).
// The customer's own request (the public page) is PR2; here it is seeded through psql (helpers/reservations.ts).

const group = (page: Page, name: string) => page.getByRole("group", { name, exact: true });
const rowOf = (page: Page, id: string) => page.locator(`[data-reservation-id="${id}"]`);

/** A new browser context at phone size: a second, independent session. */
async function phoneContext(browser: Browser, baseURL: string | undefined) {
  const context = await browser.newContext({ baseURL, viewport: { width: 360, height: 740 } });
  return { context, page: await context.newPage() };
}

test.describe("reservations on a phone (360 px)", () => {
  test.setTimeout(240_000);

  test("the owner prepares the room, accepts a request with the suggestion; a waiter opens its table; the chef is refused", async ({
    page,
    browser,
    baseURL,
  }) => {
    // --- The owner: bookable tables and a group on the settings screen -----------------------------------------------
    await signInWithMagicLink(page, createOwner());
    const tenantId = await tenantIdOf(page);
    await seedTables(page, ["Tavolo 1 (demo)", "Tavolo 2 (demo)", "Tavolo 3 (demo)"]);

    await page.goto("/tavoli/impostazioni");
    await expect(group(page, "Tavoli prenotabili")).toBeVisible();
    const tables = group(page, "Tavoli prenotabili");
    for (const [name, seats] of [
      ["Tavolo 1 (demo)", "2"],
      ["Tavolo 2 (demo)", "4"],
      ["Tavolo 3 (demo)", "4"],
    ] as const) {
      await tables.getByLabel(`${name}: prenotabile`, { exact: true }).check();
      await tables.getByLabel(`${name}: posti`, { exact: true }).fill(seats);
    }
    const [bookable] = await Promise.all([
      page.waitForResponse(
        (r) =>
          new URL(r.url()).pathname === "/api/settings/reservations/tables" &&
          r.request().method() === "PUT",
      ),
      tables.getByRole("button", { name: "Salva tavoli prenotabili", exact: true }).click(),
    ]);
    expect(bookable.status()).toBe(200);
    await expect(page.locator("main").getByRole("status")).toHaveText("Salvato.");

    const groups = group(page, "Gruppi di tavoli");
    await groups.getByLabel("Nome del gruppo", { exact: true }).fill("Tavoli 2+3");
    await groups.getByLabel("Posti del gruppo", { exact: true }).fill("8");
    await groups.getByLabel("Tavolo 2 (demo)", { exact: true }).check();
    await groups.getByLabel("Tavolo 3 (demo)", { exact: true }).check();
    const [created] = await Promise.all([
      page.waitForResponse(
        (r) => new URL(r.url()).pathname === "/api/table-groups" && r.request().method() === "POST",
      ),
      groups.getByRole("button", { name: "Crea gruppo", exact: true }).click(),
    ]);
    expect(created.status()).toBe(201);
    await expect(group(page, "Gruppi di tavoli")).toContainText(
      "Tavoli 2+3 · 8 posti · Tavolo 2 (demo), Tavolo 3 (demo)",
    );
    await expectPhoneFriendly(page);

    // --- A customer's request arrives (seeded) and the owner accepts it with the suggestion -------------------------------
    const tomorrow = await tomorrowOf(page);
    seedCustomerRequest(tenantId, tomorrow);
    // QW3: Home counts the waiting request (a number only, never the customer's name) and leads to the list in one tap.
    await page.goto("/");
    const requestsRow = page.locator("main").getByRole("link", { name: /^Prenotazioni/ });
    await expect(requestsRow).toContainText("Prenotazioni da confermare · 1");
    await expect(page.locator("main")).not.toContainText("Cliente Demo");
    await requestsRow.click();
    await expect(page).toHaveURL((url) => url.pathname === "/prenotazioni");
    await page.goto(`/prenotazioni?data=${tomorrow}`);
    await expect(page.getByRole("heading", { name: "Prenotazioni", exact: true })).toBeVisible();
    const id = await reservationIdOf(page, tomorrow, CUSTOMER);
    const row = rowOf(page, id);
    await expect(row).toContainText("20:00 · 3 persone · Cliente Demo");
    await expect(row).toContainText("Da confermare");
    await expect(page.getByRole("region", { name: "Cena", exact: true })).toContainText(
      "1 prenotazione · 3 coperti · 1 da confermare",
    );
    await expectPhoneFriendly(page);

    await row.getByRole("button", { name: "Accetta", exact: true }).click();
    // Three people: the smallest table that fits is Tavolo 2 (4 seats; Tavolo 1 has 2).
    await expect(
      page.getByText("Consigliato: Tavolo 2 (demo), 4 posti", { exact: true }),
    ).toBeVisible();
    await expectPhoneFriendly(page);
    const [accepted] = await Promise.all([
      page.waitForResponse(
        (r) =>
          new URL(r.url()).pathname === `/api/reservations/${id}/accept` &&
          r.request().method() === "POST",
      ),
      group(page, "Accetta la richiesta")
        .getByRole("button", { name: "Conferma", exact: true })
        .click(),
    ]);
    expect(accepted.status()).toBe(200);
    await expect(row).toContainText("Confermata");
    await expect(row).toContainText("Tavolo 2 (demo)");

    // --- The waiter: the booking is on its day; "Apri tavolo" leads to the comanda of that table -----------------------------
    await bookingToday(page, id);
    // Its time is now "one hour from now": read it back, never assume 20:00.
    const movedTitle = await rowTitleOf(page, await businessDateOf(page), id);
    expect(movedTitle).toContain(" · 3 persone · Cliente Demo");
    const waiter = await phoneContext(browser, baseURL);
    await signInWithMagicLink(waiter.page, await createStaff(tenantId, "waiter"), "/tavoli");
    await waiter.page.goto("/prenotazioni");
    await expect(
      waiter.page.getByRole("heading", { name: "Prenotazioni", exact: true }),
    ).toBeVisible();
    const waiterRow = rowOf(waiter.page, id);
    await expect(waiterRow).toContainText(movedTitle);
    // The waiter reads the customer's phone as a link, and has no Accetta.
    await expect(waiterRow.getByRole("link", { name: "390000000001" })).toHaveAttribute(
      "href",
      "tel:390000000001",
    );
    await expect(waiterRow.getByRole("button", { name: "Accetta", exact: true })).toHaveCount(0);
    await expectPhoneFriendly(waiter.page);
    await waiterRow.getByRole("button", { name: "Apri tavolo", exact: true }).click();
    const sheet = group(waiter.page, "Apri tavolo");
    // The covers start at the party size.
    await expect(sheet.getByLabel("Coperti", { exact: true })).toHaveValue("3");
    const [seated] = await Promise.all([
      waiter.page.waitForResponse(
        (r) =>
          new URL(r.url()).pathname === `/api/reservations/${id}/seat` &&
          r.request().method() === "POST",
      ),
      sheet.getByRole("button", { name: "Apri tavolo", exact: true }).click(),
    ]);
    expect(seated.status()).toBe(200);
    await waiter.page.waitForURL(COMANDA_URL);
    await expect(
      waiter.page.getByRole("heading", { name: "Tavolo 2 (demo)", exact: true }),
    ).toBeVisible();
    await expect(waiter.page.locator("main")).toContainText("3 coperti");

    // --- The chef is refused by the API ---------------------------------------------------------------------------------
    const chef = await phoneContext(browser, baseURL);
    await signInWithMagicLink(chef.page, await createStaff(tenantId, "chef"));
    const refused = await chef.page.request.get("/api/reservations");
    expect(refused.status()).toBe(403);
    expect(await refused.text()).not.toContain("Cliente");

    await waiter.context.close();
    await chef.context.close();
  });
});
