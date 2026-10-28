import { expect, test } from "@playwright/test";
import { tenantIdOf } from "./helpers/seed-invoice";
import { seedFiringCatalogue } from "./helpers/seed-firing";
import { createWaiter, seedTables, WAITER_A } from "./helpers/seed-menu-tables";
import { dish, newContext, openTableAndOrder, send, tab, tapDish } from "./helpers/order-ui";
import {
  createOwner,
  createStaff,
  expectPhoneFriendly,
  requireSupabaseStack,
  signInWithMagicLink,
} from "./helpers/session";

requireSupabaseStack();

// M19 acceptance test 8 on screen, on a phone (project `phone`, 360 x 740) and on a laptop (project `laptop`, 1280 x 800):
// two browser contexts, the chef on /cucina and a waiter on the order of Tavolo 1 (demo). The chef's clock is Playwright's
// (page.clock): fastForward(5_000) is one poll; 61 s with the reads blocked is the stale banner. Fake data only.
//   AT8: the waiter sends the secondi and the primi; the chef's next poll shows the tickets with their dishes; with the
//        reads aborted for 61 s the stale banner appears, and goes when a read works again.
//   The chef's main holds no euro sign; the high-contrast choice survives a reload; on the laptop there is no sideways
//   scroll and two tickets share a row; on the phone every target is at least 44 px; a waiter opening /cucina is told it is
//   not for their role, and that message holds no euro sign either.

const KITCHEN_API = "**/api/kitchen/tickets";

test.describe("the kitchen list", () => {
  test.setTimeout(300_000);

  test("a sent course reaches the kitchen screen; a minute without a read shows the stale banner (AT8)", async ({
    page,
    browser,
  }, testInfo) => {
    const onLaptop = testInfo.project.name === "laptop";

    // --- The owner seeds the menu and a table; a waiter opens it and takes a primo and a secondo --------------------------
    await signInWithMagicLink(page, createOwner());
    const tenantId = await tenantIdOf(page);
    const ids = await seedFiringCatalogue(page, tenantId);
    const tables = await seedTables(page, ["Tavolo 1 (demo)"]);
    const waiterEmail = await createWaiter(tenantId, WAITER_A);
    const chefEmail = await createStaff(tenantId, "chef");

    const waiter = await newContext(browser, testInfo.project.use);
    await signInWithMagicLink(waiter.page, waiterEmail);
    const sessionId = await openTableAndOrder(waiter.page, tables["Tavolo 1 (demo)"]!);
    await tab(waiter.page, /^Secondi/).click();
    const stew = await tapDish(waiter.page, sessionId, dish(waiter.page, ids.stew));
    await tab(waiter.page, /^Primi/).click();
    const pasta = await tapDish(waiter.page, sessionId, dish(waiter.page, ids.tagliatelle));

    // --- The chef opens /cucina with a fake clock: nothing is there yet ----------------------------------------------------
    const chef = await newContext(browser, testInfo.project.use);
    await signInWithMagicLink(chef.page, chefEmail);
    await chef.page.clock.install();
    await chef.page.goto("/cucina");
    await expect(chef.page.getByRole("heading", { name: "Cucina", exact: true })).toBeVisible();
    await expect(chef.page.getByText("Nessuna comanda in cucina.")).toBeVisible();

    // --- The waiter sends the secondi, then the primi --------------------------------------------------------------------
    await waiter.page.getByRole("button", { name: /^Comanda/ }).click();
    await send(waiter.page, sessionId, "Invia in cucina: Secondi, 1 piatto");
    await send(waiter.page, sessionId, "Invia in cucina: Primi, 1 piatto");

    // One poll later (5 s of the chef's clock) the tickets are there, found by key, with their dishes.
    const [polled] = await Promise.all([
      chef.page.waitForResponse((r) => new URL(r.url()).pathname === "/api/kitchen/tickets"),
      chef.page.clock.fastForward(5_000),
    ]);
    expect(polled.status()).toBe(200);
    const body = (await polled.json()) as {
      tickets: {
        key: string;
        sessionId: string;
        course: string;
        lines: { id: string; name: string }[];
      }[];
    };
    const ticketOf = (course: string) =>
      body.tickets.find((t) => t.sessionId === sessionId && t.course === course)!;
    const stewTicket = ticketOf("secondi");
    const pastaTicket = ticketOf("primi");
    expect(stewTicket.lines.map((l) => l.id)).toEqual([stew]);
    expect(pastaTicket.lines.map((l) => l.id)).toEqual([pasta]);
    const stewCard = chef.page.locator(`[data-ticket-key="${stewTicket.key}"]`);
    const pastaCard = chef.page.locator(`[data-ticket-key="${pastaTicket.key}"]`);
    await expect(stewCard).toContainText("Spezzatino con polenta (demo)");
    await expect(stewCard).toContainText("Tavolo 1 (demo)");
    await expect(pastaCard).toContainText("Tagliatelle al ragù (demo)");

    // The chef's screen holds no euro sign.
    expect(await chef.page.locator("main").innerText()).not.toContain("€");

    // --- AT8: 61 s without a successful read show the stale banner; the list stays; a read brings it back to normal --------
    await expect(chef.page.getByRole("main").getByRole("alert")).toHaveCount(0);
    await chef.page.route(KITCHEN_API, (route) => route.abort());
    await chef.page.clock.fastForward(61_000);
    const banner = chef.page.getByRole("main").getByRole("alert");
    await expect(banner).toHaveText(
      "Dati non aggiornati da più di un minuto. Controlla la connessione.",
    );
    await expect(stewCard).toBeVisible();
    await chef.page.unroute(KITCHEN_API);
    await chef.page.clock.fastForward(5_000);
    await expect(chef.page.getByRole("main").getByRole("alert")).toHaveCount(0);

    // --- High contrast survives a reload ----------------------------------------------------------------------------------
    const root = chef.page.locator("[data-kitchen]");
    await chef.page.getByRole("button", { name: "Alto contrasto", exact: true }).click();
    await expect(root).toHaveAttribute("data-contrast", "high");
    await chef.page.reload();
    await expect(chef.page.locator("[data-kitchen]")).toHaveAttribute("data-contrast", "high");
    await expect(
      chef.page.getByRole("button", { name: "Alto contrasto", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");

    // --- Layout: laptop and phone ---------------------------------------------------------------------------------------------
    if (onLaptop) {
      const sideways = await chef.page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      );
      expect(sideways).toBe(false);
      const firstBox = await chef.page
        .locator(`[data-ticket-key="${stewTicket.key}"]`)
        .boundingBox();
      const secondBox = await chef.page
        .locator(`[data-ticket-key="${pastaTicket.key}"]`)
        .boundingBox();
      expect(firstBox).not.toBeNull();
      expect(secondBox).not.toBeNull();
      // Two cards share a row: the same top edge, side by side.
      expect(secondBox!.y).toBe(firstBox!.y);
      expect(secondBox!.x).not.toBe(firstBox!.x);
    } else {
      await expectPhoneFriendly(chef.page);
    }

    // --- A waiter on /cucina is told it is not for their role, without a euro sign ------------------------------------------
    await waiter.page.goto("/cucina");
    const notice = waiter.page.getByRole("main").getByRole("alert");
    await expect(notice).toHaveText("La lista della cucina non è disponibile per il tuo ruolo.");
    expect(await notice.innerText()).not.toContain("€");

    await chef.context.close();
    await waiter.context.close();
  });
});
