import { expect, test, type Page, type Response } from "@playwright/test";
import { tenantIdOf } from "./helpers/seed-invoice";
import { MIN_MEASURED_TAP_PX } from "./helpers/tap";
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
    await signInWithMagicLink(waiter.page, waiterEmail, "/tavoli");
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
    // Scoped to main: the sidebar has a "Cucina" group heading too (laptop).
    await expect(
      chef.page.locator("main").getByRole("heading", { name: "Cucina", exact: true }),
    ).toBeVisible();
    // /cucina is not a focus route: the chef keeps the navigation, with "Comande" current (the way back to Oggi and the rest).
    await expect(
      chef.page
        .getByRole("navigation", { name: "Menu principale" })
        .getByRole("link", { name: "Comande", exact: true }),
    ).toHaveAttribute("aria-current", "page");
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
      // Two cards share a row: the same top edge (to within a pixel: layout can land on sub-pixel
      // positions, 213.04 vs 212.89 in CI), side by side.
      expect(Math.abs(secondBox!.y - firstBox!.y)).toBeLessThan(1);
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

// M19b acceptance tests on screen, on a phone and on a laptop: the chef on /cucina marks dishes "Fatto", undoes them, closes and reopens
// comande; a second kitchen device (the owner) follows; the waiter keeps sending. The chef's clock is Playwright's (page.clock): fastForward(600)
// passes the tap guard, fastForward(5_000) is one poll. Rows and cards are found by data-line-id and data-ticket-key, never by position. Fake data only.
//   AT1, AT15: a tap marks a dish (struck, pressed, "1 di 2 fatti", "Da fare" down by one).    AT2: a second tap after 600 ms takes it back.
//   AT3: a quick double tap posts once.    AT4: the last dish closes the comanda (notice, "Annulla" brings it back).
//   AT5: "Chiudi comanda" -> "Chiuse oggi" -> "Riapri".    AT6: the owner's device sees the close after one poll.
//   AT9: dishes sent after the close form a new comanda.    AT11: no euro sign.    AT12: offline disables the controls.
//   AT14: 44 px targets, no dialog, no sideways scroll at 360, 768 and 1280 px.    AT7: a waiter on /cucina gets the role message and no dish button.
test.describe("Fatto e chiusura", () => {
  test.setTimeout(300_000);

  const isMark = (r: Response) =>
    r.request().method() === "POST" &&
    /\/api\/kitchen\/(lines\/[0-9a-f-]+|tickets)\/mark$/.test(new URL(r.url()).pathname);
  /** Clicks, waits for the write to answer 200, and returns the reply. */
  async function tap(page: Page, control: ReturnType<Page["locator"]>) {
    const [response] = await Promise.all([page.waitForResponse(isMark), control.click()]);
    expect(response.status(), await response.text()).toBe(200);
    return (await response.json()) as {
      changed: boolean;
      autoClosed?: boolean;
      reopened?: boolean;
    };
  }
  const board = async (page: Page) =>
    (await (await page.request.get("/api/kitchen/tickets")).json()) as {
      tickets: { key: string; sessionId: string; course: string; lines: { id: string }[] }[];
      closedTickets: { key: string }[];
    };
  const remaining = (page: Page) => page.locator("main [data-remaining]");

  test("the chef marks dishes done, closes and reopens comande; the owner's device follows (AT1-AT6, AT9, AT11, AT12, AT14)", async ({
    page,
    browser,
  }, testInfo) => {
    const onLaptop = testInfo.project.name === "laptop";

    // --- Seed: the waiter sends two primi (tagliatelle, zuppa) and one secondo (stew) ----------------------------------------
    await signInWithMagicLink(page, createOwner());
    const tenantId = await tenantIdOf(page);
    const ids = await seedFiringCatalogue(page, tenantId);
    const tables = await seedTables(page, ["Tavolo 1 (demo)"]);
    const waiterEmail = await createWaiter(tenantId, WAITER_A);
    const chefEmail = await createStaff(tenantId, "chef");

    const waiter = await newContext(browser, testInfo.project.use);
    await signInWithMagicLink(waiter.page, waiterEmail, "/tavoli");
    const sessionId = await openTableAndOrder(waiter.page, tables["Tavolo 1 (demo)"]!);
    await tab(waiter.page, /^Secondi/).click();
    const stew = await tapDish(waiter.page, sessionId, dish(waiter.page, ids.stew));
    await tab(waiter.page, /^Primi/).click();
    const pasta = await tapDish(waiter.page, sessionId, dish(waiter.page, ids.tagliatelle));
    const soup = await tapDish(waiter.page, sessionId, dish(waiter.page, ids.zuppa));
    await waiter.page.getByRole("button", { name: /^Comanda/ }).click();
    await send(waiter.page, sessionId, "Invia in cucina: Secondi, 1 piatto");
    await send(waiter.page, sessionId, "Invia in cucina: Primi, 2 piatti");

    // --- The chef opens /cucina (fake clock) and one poll later has the two comande ---------------------------------------------
    const chef = await newContext(browser, testInfo.project.use);
    await signInWithMagicLink(chef.page, chefEmail);
    await chef.page.clock.install();
    await chef.page.goto("/cucina");
    await chef.page.clock.fastForward(5_000);
    const first = await board(chef.page);
    const pastaKey = first.tickets.find(
      (t) => t.sessionId === sessionId && t.course === "primi",
    )!.key;
    const stewKey = first.tickets.find(
      (t) => t.sessionId === sessionId && t.course === "secondi",
    )!.key;
    const pastaCard = chef.page.locator(`[data-ticket-key="${pastaKey}"]`);
    const stewCard = chef.page.locator(`[data-ticket-key="${stewKey}"]`);
    const row = (id: string) => chef.page.locator(`[data-line-id="${id}"]`);
    const inMain = chef.page.getByRole("main");
    await expect(pastaCard).toBeVisible();
    await expect(remaining(chef.page)).toHaveAttribute("data-remaining", "3");
    expect(first.tickets.find((t) => t.key === stewKey)!.lines.map((l) => l.id)).toEqual([stew]);
    await expect(stewCard).toBeVisible();

    // --- AT1, AT15: one tap marks the tagliatelle -------------------------------------------------------------------------------
    await tap(chef.page, row(pasta).getByRole("button", { name: /^Segna fatto: 1 × Tagliatelle/ }));
    await expect(row(pasta).getByRole("button")).toHaveAttribute("aria-pressed", "true");
    await expect(row(pasta).locator(".line-through").first()).toBeVisible();
    await expect(pastaCard.locator("[data-done-count]")).toHaveText("1 di 2 fatti");
    await expect(remaining(chef.page)).toHaveAttribute("data-remaining", "2");

    // --- AT2: a second tap after 600 ms takes it back ---------------------------------------------------------------------------
    await chef.page.clock.fastForward(600);
    await tap(
      chef.page,
      row(pasta).getByRole("button", { name: /^Annulla fatto: 1 × Tagliatelle/ }),
    );
    await expect(pastaCard.locator("[data-done-count]")).toHaveText("0 di 2 fatti");
    await expect(remaining(chef.page)).toHaveAttribute("data-remaining", "3");

    // --- AT3: a quick double tap posts once -------------------------------------------------------------------------------------
    let posts = 0;
    chef.page.on("request", (r) => {
      if (
        r.method() === "POST" &&
        /\/api\/kitchen\/lines\/[0-9a-f-]+\/mark$/.test(new URL(r.url()).pathname)
      )
        posts += 1;
    });
    const soupButton = row(soup).getByRole("button", { name: /^Segna fatto: 1 × Zuppa/ });
    const [doubled] = await Promise.all([chef.page.waitForResponse(isMark), soupButton.dblclick()]);
    expect(doubled.status()).toBe(200);
    await expect(row(soup).getByRole("button")).toHaveAttribute("aria-pressed", "true");
    expect(posts).toBe(1);
    await chef.page.clock.fastForward(600);
    await tap(chef.page, row(soup).getByRole("button", { name: /^Annulla fatto: 1 × Zuppa/ }));
    await expect(row(soup).getByRole("button")).toHaveAttribute("aria-pressed", "false");

    // --- AT4: the last open dish closes the comanda; Annulla brings it back -----------------------------------------------------
    await tap(chef.page, row(pasta).getByRole("button", { name: /^Segna fatto: 1 × Tagliatelle/ }));
    await chef.page.clock.fastForward(600);
    const last = await tap(
      chef.page,
      row(soup).getByRole("button", { name: /^Segna fatto: 1 × Zuppa/ }),
    );
    expect(last.autoClosed).toBe(true);
    await expect(pastaCard).toHaveCount(0);
    await expect(inMain.getByRole("status")).toContainText(
      "Tavolo 1 (demo) · Primi: comanda chiusa",
    );
    await chef.page.clock.fastForward(600);
    const undone = await tap(
      chef.page,
      inMain.getByRole("button", { name: "Annulla", exact: true }),
    );
    expect(undone.reopened).toBe(true);
    await expect(pastaCard).toBeVisible();
    await expect(inMain.getByRole("status")).toHaveCount(0);

    // --- AT5, AT6: "Chiudi comanda" on the secondi; the owner's device follows; "Riapri" puts it back ------------------------
    const owner = page;
    await owner.clock.install();
    await owner.goto("/cucina");
    await expect(
      owner.getByRole("main").getByRole("heading", { name: "Cucina", exact: true }),
    ).toBeVisible();
    await tap(chef.page, stewCard.getByRole("button", { name: /^Chiudi comanda/ }));
    await expect(stewCard).toHaveCount(0);
    await chef.page
      .getByRole("main")
      .getByRole("button", { name: "Chiuse oggi (1)", exact: true })
      .click();
    const closedStew = chef.page.locator(`[data-ticket-key="${stewKey}"]`);
    await expect(closedStew).toContainText("0 di 1 fatti");
    await expect(closedStew).toContainText("Chiusa alle");
    await owner.clock.fastForward(5_000);
    await expect(
      owner.getByRole("main").getByRole("button", { name: "Chiuse oggi (1)", exact: true }),
    ).toBeVisible();
    await tap(chef.page, closedStew.getByRole("button", { name: /^Riapri comanda/ }));
    await expect(
      chef.page.locator(`article[data-ticket-key="${stewKey}"] [data-done-count]`),
    ).toBeVisible();
    await expect(inMain.getByRole("button", { name: /^Chiuse oggi/ })).toHaveCount(0);

    // --- AT9: the primi are closed again; a primo sent afterwards is a NEW comanda ------------------------------------------------
    await chef.page.clock.fastForward(600);
    const closedAgain = await tap(
      chef.page,
      row(soup).getByRole("button", { name: /^Segna fatto: 1 × Zuppa/ }),
    );
    expect(closedAgain.autoClosed).toBe(true);
    await expect(pastaCard).toHaveCount(0);
    await tab(waiter.page, /^Primi/).click();
    const pasta2 = await tapDish(waiter.page, sessionId, dish(waiter.page, ids.tagliatelle));
    await waiter.page.getByRole("button", { name: /^Comanda/ }).click();
    await send(waiter.page, sessionId, "Invia in cucina: Primi, 1 piatto");
    await chef.page.clock.fastForward(5_000);
    const later = await board(chef.page);
    const fresh = later.tickets.find((t) => t.lines.some((l) => l.id === pasta2))!;
    expect(fresh.key).not.toBe(pastaKey);
    expect(later.closedTickets.map((t) => t.key)).toContain(pastaKey);
    await expect(chef.page.locator(`[data-ticket-key="${fresh.key}"]`)).toBeVisible();

    // --- AT12: no connection: every kitchen control is disabled, with the reason; back online they work ------------------------------
    const freshDish = chef.page.locator(`[data-line-id="${pasta2}"]`).getByRole("button");
    await chef.context.setOffline(true);
    await expect(inMain.getByText("Serve la connessione per segnare i piatti.")).toBeVisible();
    await expect(freshDish).toBeDisabled();
    await expect(
      chef.page
        .locator(`[data-ticket-key="${fresh.key}"]`)
        .getByRole("button", { name: /^Chiudi comanda/ }),
    ).toBeDisabled();
    await chef.context.setOffline(false);
    await expect(inMain.getByText("Serve la connessione per segnare i piatti.")).toHaveCount(0);
    await expect(freshDish).toBeEnabled();

    // --- AT11, AT14: no euro sign, targets of at least 44 px, no dialog, no sideways scroll ------------------------------------------
    await chef.page
      .getByRole("main")
      .getByRole("button", { name: "Chiuse oggi (1)", exact: true })
      .click();
    expect(await inMain.innerText()).not.toContain("€");
    for (const button of await inMain.getByRole("button").all()) {
      const box = await button.boundingBox();
      expect(box, await button.innerText()).not.toBeNull();
      expect(box!.height).toBeGreaterThanOrEqual(MIN_MEASURED_TAP_PX);
    }
    await expect(chef.page.getByRole("dialog")).toHaveCount(0);
    const sideways = () =>
      chef.page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      );
    expect(await sideways()).toBe(false);
    if (onLaptop) {
      await chef.page.setViewportSize({ width: 768, height: 1024 });
      expect(await sideways()).toBe(false);
      await chef.page.setViewportSize({ width: 1280, height: 800 });
      expect(await sideways()).toBe(false);
      const a = await chef.page.locator(`[data-ticket-key="${fresh.key}"]`).boundingBox();
      const b = await chef.page.locator(`[data-ticket-key="${stewKey}"]`).boundingBox();
      expect(a).not.toBeNull();
      expect(b).not.toBeNull();
      expect(Math.abs(a!.y - b!.y)).toBeLessThan(1);
    } else {
      await expectPhoneFriendly(chef.page);
    }

    // --- AT7: a waiter on /cucina is told it is not for their role, and has no dish button ------------------------------------------------
    await waiter.page.goto("/cucina");
    await expect(waiter.page.getByRole("main").getByRole("alert")).toHaveText(
      "La lista della cucina non è disponibile per il tuo ruolo.",
    );
    await expect(
      waiter.page.getByRole("main").getByRole("button", { name: /^Segna fatto/ }),
    ).toHaveCount(0);

    await chef.context.close();
    await waiter.context.close();
  });
});
