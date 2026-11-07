import { expect, test, type Page } from "@playwright/test";
import { collectCspViolations, type CspCollector } from "../helpers/csp";
import { ledgerFindings } from "../helpers/invariants";
import {
  expectNothingQueued,
  expectQueued,
  goOffline,
  goOnline,
  isSyncPost,
  serviceWorkerReady,
  type SyncReply,
} from "../helpers/offline";
import {
  bar,
  dish,
  main,
  newContext,
  openTableAndOrder,
  send,
  tab,
  tapDish,
} from "../helpers/order-ui";
import { closeAs } from "../helpers/seed-closing";
import { tenantIdOf } from "../helpers/seed-invoice";
import { createWaiter, WAITER_A, WAITER_B } from "../helpers/seed-menu-tables";
import { RAGU, STEW } from "../helpers/seed-recipe";
import { BEEF, INVOICE_KG, seedService } from "../helpers/seed-service";
import { businessDateOf, dayServices, setTableService } from "../helpers/services";
import {
  createOwner,
  createStaff,
  requireSupabaseStack,
  signInWithMagicLink,
} from "../helpers/session";

requireSupabaseStack();

// M25 step 17, AT1: one service from the invoices to the invariants, on phones (360 x 740), Chromium (`service-sim`). Fake data only. Nothing here
// is a date or an hour: the business date is the app's own (GET /api/tables), and every figure is derived from the fixture below.
//
//   people    the owner, the chef, "Cameriere Demo" (A, tables 1 to 3) and "Cameriere Due Demo" (B, tables 4 to 6); each has its own browser context
//   stock     two invoices of 6 kg of beef; the chef makes 20 portions of the stew (3,5 kg used) and 20 of the ragù (4 kg used), so 4,5 kg are left
//   covers    2, 2, 3 (A) and 4, 2, 3 (B): 16 in all. Each cover has one bruschetta, one ragù and one stew; a cover costs 5 + 11 + 14 + 2 (coperto) = 32,00 €,
//             so the day is 512,00 € and every plate is left with 20 - 16 = 4 portions
//   offline   B has no connection while it orders and sends the primi of tables 4 to 6; the phone queues every add and fire, the kitchen sees none
//             of them, and all of them are applied when the connection is back
//   closes    table 1 on screen with a receipt number, tables 2 to 5 through the API, table 6 on screen without a number (it is flagged)
//   day       the register says 10,00 € more than the app; Pranzo (tables 1 to 3, 7 covers) and Cena (tables 4 to 6, 9 covers) add up to the day
// Headings and buttons are found by their exact names inside `main`; rows by data attributes; there is no positional locator.

const COVERS = [2, 2, 3, 4, 2, 3];
const A_TABLES = [0, 1, 2];
const B_TABLES = [3, 4, 5];
const PORTIONS = 20;
const TOTAL_COVERS = COVERS.reduce((sum, covers) => sum + covers, 0);
/** Per cover, in cents: bruschetta 5,00 + ragù 11,00 + stew 14,00 + coperto 2,00. */
const PER_COVER_CENTS = 3200;
const REGISTER_EXTRA_CENTS = 1000;
const STEW_BEEF_KG = 3.5;
const RAGU_BEEF_KG = 4;

const cents = (eur: number) => Math.round(eur * 100);
/** 51200 -> "512,00" (the app writes amounts as 1.234,50; the day here is under 1.000). */
function eurText(amountCents: number): string {
  const whole = String(Math.floor(Math.abs(amountCents) / 100)).replace(
    /\B(?=(\d{3})+(?!\d))/g,
    ".",
  );
  return `${whole},${String(Math.abs(amountCents) % 100).padStart(2, "0")}`;
}
const comanda = (sessionId: string) => `/tavoli/comanda?s=${sessionId}`;
const billUrl = (sessionId: string) => `${comanda(sessionId)}&vista=conto`;

async function getJson<T>(page: Page, path: string): Promise<T> {
  const reply = await page.request.get(path);
  expect(reply.status(), `${path}: ${await reply.text()}`).toBe(200);
  return (await reply.json()) as T;
}

type MenuRead = {
  pinned: unknown[];
  categories: { items: { id: string; portionsLeft: number | null }[] }[];
};
async function portionsLeft(page: Page, menuItemId: string): Promise<number | null> {
  const menu = await getJson<MenuRead>(page, "/api/menu");
  const item = menu.categories
    .flatMap((category) => category.items)
    .find((i) => i.id === menuItemId);
  expect(item, "the dish is on the menu").toBeDefined();
  return item!.portionsLeft;
}

test.describe("the service simulation (AT1)", () => {
  // The test as a whole may take 15 minutes, but one action never should: a locator that cannot match fails in seconds with its
  // name, not after the whole budget (run 42387206662). Every assertion stays as strict as it was.
  test.use({ actionTimeout: 20_000, navigationTimeout: 45_000 });

  test("a full service, from the invoices to the ledgers, Pranzo and Cena included", async ({
    page,
    browser,
  }, testInfo) => {
    test.setTimeout(900_000);

    const collectors: CspCollector[] = [await collectCspViolations(page.context())];
    await signInWithMagicLink(page, createOwner());
    const tenantId = await tenantIdOf(page);
    const fixture = await seedService(page, tenantId);
    const { menu, tableIds } = fixture;

    const chef = await newContext(browser, testInfo.project.use);
    collectors.push(await collectCspViolations(chef.context));
    await signInWithMagicLink(chef.page, await createStaff(tenantId, "chef"));

    const a = await newContext(browser, testInfo.project.use);
    collectors.push(await collectCspViolations(a.context));
    await signInWithMagicLink(a.page, await createWaiter(tenantId, WAITER_A), "/tavoli");

    const b = await newContext(browser, testInfo.project.use);
    collectors.push(await collectCspViolations(b.context));
    await signInWithMagicLink(b.page, await createWaiter(tenantId, WAITER_B), "/tavoli");

    const waiterOf = (index: number) => (A_TABLES.includes(index) ? a : b);
    const sessions: string[] = [];
    let day = "";

    await test.step("1 invoices", async () => {
      for (const invoiceId of fixture.invoiceIds) {
        await page.goto(`/fatture/${invoiceId}/revisione`);
        const panel = page.getByTestId("approval-panel");
        await panel.getByRole("button", { name: "Approva fattura", exact: true }).click();
        await panel.getByRole("button", { name: "Conferma approvazione", exact: true }).click();
        await expect(page.getByTestId("invoice-status")).toHaveText("Approvata");
      }
      const stock = await getJson<{ items: { name: string; onHandQty: number }[] }>(
        page,
        "/api/stock",
      );
      expect(stock.items.find((item) => item.name === BEEF)?.onHandQty).toBe(INVOICE_KG * 2);
    });

    await test.step("2 production", async () => {
      // The stew on screen: 4 kg of the 6 kg / 30 portion recipe is 20 portions; the chef used 3,5 kg of beef.
      await chef.page.goto("/produzione/nuova");
      await expect(
        main(chef.page).getByRole("heading", { name: "Nuova produzione", exact: true }),
      ).toBeVisible();
      await main(chef.page).getByRole("combobox", { name: "Ricetta", exact: true }).selectOption({
        label: STEW,
      });
      await main(chef.page).getByRole("textbox", { name: "Quantità prodotta" }).fill("4");
      const [proposal] = await Promise.all([
        chef.page.waitForResponse(
          (response) => response.url().includes("/api/batches/proposal") && response.ok(),
        ),
        main(chef.page).getByRole("button", { name: "Calcola", exact: true }).click(),
      ]);
      expect(proposal.ok()).toBe(true);
      const beef = main(chef.page).getByRole("listitem").filter({ hasText: BEEF });
      await beef.getByLabel("Usato", { exact: true }).fill(String(STEW_BEEF_KG).replace(".", ","));
      await expect(main(chef.page).getByLabel("Porzioni")).toHaveValue(String(PORTIONS));
      const [made] = await Promise.all([
        chef.page.waitForResponse(
          (r) => r.url().endsWith("/api/batches") && r.request().method() === "POST",
        ),
        main(chef.page).getByRole("button", { name: "Registra produzione", exact: true }).click(),
      ]);
      expect(made.status()).toBe(201);
      await chef.page.waitForURL(/\/produzione\/[0-9a-f-]+\/etichetta\?nuovo=1/);

      // The ragù through the production route: 4 kg of the 2 kg / 10 portion recipe is 20 portions.
      const proposalReply = await getJson<{ recipe: { id: string } }>(
        chef.page,
        `/api/batches/proposal?recipeKey=${fixture.raguKey}`,
      );
      const ragu = await chef.page.request.post("/api/batches", {
        data: {
          recipeId: proposalReply.recipe.id,
          outputQty: 4,
          portions: PORTIONS,
          locationId: fixture.cellaId,
          inputs: [
            {
              ingredientId: fixture.beefId,
              qty: RAGU_BEEF_KG,
              unit: "kg",
              locationId: fixture.cellaId,
            },
          ],
        },
      });
      expect(ragu.status(), await ragu.text()).toBe(201);

      expect(await portionsLeft(a.page, menu.stew)).toBe(PORTIONS);
      expect(await portionsLeft(a.page, menu.tagliatelle)).toBe(PORTIONS);
    });

    await test.step("3 antipasti", async () => {
      // B's phone gets its service worker before it opens any table, so every comanda it loads (and its lines) is stored for stage 4.
      await b.page.waitForLoadState("networkidle");
      await serviceWorkerReady(b.page);
      for (const [index, tableId] of tableIds.entries()) {
        const who = waiterOf(index);
        const covers = COVERS[index]!;
        const sessionId = await openTableAndOrder(who.page, tableId, covers);
        sessions.push(sessionId);
        await tab(who.page, /^Antipasti/).click();
        for (let n = 0; n < covers; n += 1) {
          await tapDish(who.page, sessionId, dish(who.page, menu.bruschetta));
        }
        await bar(who.page).click();
        await expect(bar(who.page)).toHaveAttribute("aria-expanded", "true");
        const fired = await send(
          who.page,
          sessionId,
          `Invia in cucina: Antipasti, ${covers} piatti`,
        );
        expect(fired.fired).toHaveLength(covers);
        expect(fired.skipped).toEqual([]);
      }
      expect(sessions).toHaveLength(6);
      day = await businessDateOf(page);
    });

    await test.step("4 primi", async () => {
      // A is online: tables 1 to 3.
      for (const index of A_TABLES) {
        const covers = COVERS[index]!;
        await a.page.goto(comanda(sessions[index]!));
        await tab(a.page, /^Primi/).click();
        for (let n = 0; n < covers; n += 1) {
          await tapDish(a.page, sessions[index]!, dish(a.page, menu.tagliatelle));
        }
        await bar(a.page).click();
        const fired = await send(
          a.page,
          sessions[index]!,
          `Invia in cucina: Primi, ${covers} piatti`,
        );
        expect(fired.fired).toHaveLength(covers);
      }

      // B has no connection: tables 4 to 6. Every add and every fire waits in the phone's queue.
      const replies: SyncReply[] = [];
      const pending: Promise<void>[] = [];
      b.page.on("response", (response) => {
        if (isSyncPost(response) && response.status() === 200) {
          pending.push(response.json().then((reply: SyncReply) => void replies.push(reply)));
        }
      });
      await Promise.all(pending);
      const syncedBefore = replies.length;
      await serviceWorkerReady(b.page);
      await goOffline(b.context);

      let queued = 0;
      for (const index of B_TABLES) {
        const covers = COVERS[index]!;
        await b.page.goto(comanda(sessions[index]!));
        await expect(tab(b.page, /^Primi/)).toBeVisible();
        await tab(b.page, /^Primi/).click();
        for (let n = 0; n < covers; n += 1) {
          await dish(b.page, menu.tagliatelle).click();
          queued += 1;
          await expectQueued(b.page, queued);
        }
        await bar(b.page).click();
        await b.page
          .getByRole("button", { name: `Invia in cucina: Primi, ${covers} piatti`, exact: true })
          .click();
        queued += 1;
        await expectQueued(b.page, queued);
      }
      const bOps = B_TABLES.reduce((sum, index) => sum + COVERS[index]! + 1, 0);
      expect(queued).toBe(bOps);

      // Nothing of B reached the server, and the kitchen has A's primi only.
      await Promise.all(pending);
      expect(replies.length).toBe(syncedBefore);
      const primiCard = (sessionId: string) =>
        chef.page.locator(
          `[data-ticket-key^="${sessionId}|"][data-ticket-key*="|primi|"]:not([data-closed])`,
        );
      await chef.page.goto("/cucina");
      await expect(
        main(chef.page).getByRole("heading", { name: "Cucina", exact: true }),
      ).toBeVisible();
      for (const index of A_TABLES) {
        await expect(primiCard(sessions[index]!)).toBeVisible({ timeout: 20_000 });
      }
      for (const index of B_TABLES) {
        await expect(primiCard(sessions[index]!)).toHaveCount(0);
      }
      const board = await getJson<{ tickets: { sessionId: string; course: string }[] }>(
        chef.page,
        "/api/kitchen/tickets",
      );
      expect(
        board.tickets
          .filter((ticket) => ticket.course === "primi")
          .map((ticket) => ticket.sessionId)
          .sort(),
      ).toEqual(A_TABLES.map((index) => sessions[index]!).sort());

      // The connection is back: every queued operation is applied, none is left on the phone.
      await goOnline(b.context);
      await expectNothingQueued(b.page);
      await expect
        .poll(
          async () => {
            await Promise.all(pending);
            return replies.slice(syncedBefore).flatMap((reply) => reply.results).length;
          },
          { message: "operations replayed from B" },
        )
        .toBe(bOps);
      const replayed = replies.slice(syncedBefore).flatMap((reply) => reply.results);
      expect(replayed.every((result) => result.status === "applied")).toBe(true);
      for (const index of B_TABLES) {
        await expect(primiCard(sessions[index]!)).toBeVisible({ timeout: 30_000 });
      }
      expect(await portionsLeft(a.page, menu.tagliatelle)).toBe(PORTIONS - TOTAL_COVERS);
    });

    await test.step("5 secondi", async () => {
      for (const [index, sessionId] of sessions.entries()) {
        const who = waiterOf(index);
        const covers = COVERS[index]!;
        await who.page.goto(comanda(sessionId));
        await tab(who.page, /^Secondi/).click();
        for (let n = 0; n < covers; n += 1) {
          await tapDish(who.page, sessionId, dish(who.page, menu.stew));
        }
        await bar(who.page).click();
        const fired = await send(who.page, sessionId, `Invia in cucina: Secondi, ${covers} piatti`);
        expect(fired.fired).toHaveLength(covers);
      }
      expect(await portionsLeft(a.page, menu.stew)).toBe(PORTIONS - TOTAL_COVERS);
    });

    let totalCents = 0;
    await test.step("6 closes", async () => {
      for (const [index, sessionId] of sessions.entries()) {
        const bill = await getJson<{ total: number; covers: number; unsentLineIds: string[] }>(
          waiterOf(index).page,
          `/api/table-sessions/${sessionId}/bill`,
        );
        expect(bill.covers).toBe(COVERS[index]);
        expect(bill.unsentLineIds).toEqual([]);
        expect(cents(bill.total)).toBe(COVERS[index]! * PER_COVER_CENTS);
        totalCents += cents(bill.total);
      }
      expect(totalCents).toBe(TOTAL_COVERS * PER_COVER_CENTS);

      // Table 1, on screen, with the number the register printed.
      await a.page.goto(billUrl(sessions[0]!));
      await main(a.page).getByRole("button", { name: "Chiudi tavolo", exact: true }).click();
      await a.page.getByRole("radio", { name: "Scontrino", exact: true }).check();
      await a.page.getByRole("radio", { name: "Carta", exact: true }).check();
      await a.page.getByLabel(/^Numero/).fill("0001-0001");
      await a.page
        .locator("[data-close-sheet]")
        .getByRole("button", { name: "Chiudi tavolo", exact: true })
        .click();
      await expect(
        main(a.page).getByText("Tavolo chiuso · Scontrino 0001-0001 · Carta"),
      ).toBeVisible();

      // Tables 2 to 5 through the API, by the waiter who took them.
      await closeAs(a.page, sessions[1]!, {
        receiptType: "scontrino",
        receiptNumber: "0001-0002",
        paymentType: "cash",
      });
      await closeAs(a.page, sessions[2]!, {
        receiptType: "fattura",
        receiptNumber: "FT-0003",
        paymentType: "other",
      });
      await closeAs(b.page, sessions[3]!, {
        receiptType: "scontrino",
        receiptNumber: "0001-0004",
        paymentType: "card",
      });
      await closeAs(b.page, sessions[4]!, {
        receiptType: "scontrino",
        receiptNumber: "0001-0005",
        paymentType: "cash",
      });

      // Table 6, on screen, without a number: it closes and is flagged.
      await b.page.goto(billUrl(sessions[5]!));
      await main(b.page).getByRole("button", { name: "Chiudi tavolo", exact: true }).click();
      await b.page.getByRole("radio", { name: "Scontrino", exact: true }).check();
      await b.page.getByRole("radio", { name: "Carta", exact: true }).check();
      await expect(
        main(b.page).getByText("Il tavolo sarà segnalato nella chiusura di cassa."),
      ).toBeVisible();
      await main(b.page).getByRole("button", { name: "Chiudi senza numero", exact: true }).click();
      await expect(
        main(b.page).getByText("Tavolo chiuso · senza numero di scontrino"),
      ).toBeVisible();
    });

    await test.step("7 day close", async () => {
      expect(await businessDateOf(page), "the run crossed the 02:00 cut-off").toBe(day);
      await page.goto("/chiusura");
      await expect(
        main(page).getByRole("heading", { name: "Chiusura di cassa", exact: true }),
      ).toBeVisible();
      const appTotal = new RegExp(
        `Totale app ${eurText(totalCents)}\\s+€ · 6 tavoli · ${TOTAL_COVERS} coperti`,
      );
      await expect(main(page)).toContainText(appTotal);
      await expect(
        main(page).getByRole("heading", {
          name: "Tavoli chiusi senza numero di scontrino (1)",
          exact: true,
        }),
      ).toBeVisible();
      await expect(main(page).locator(`[data-session-id="${sessions[5]!}"]`)).toBeVisible();

      // The register says 10,00 € more than the app.
      await main(page)
        .getByLabel("Totale del registratore di cassa", { exact: true })
        .fill(eurText(totalCents + REGISTER_EXTRA_CENTS));
      const [saved] = await Promise.all([
        page.waitForResponse(
          (r) => new URL(r.url()).pathname === "/api/day-close" && r.request().method() === "POST",
        ),
        main(page).getByRole("button", { name: "Salva", exact: true }).click(),
      ]);
      expect(saved.status()).toBe(200);
      await expect(main(page)).toContainText(
        new RegExp(`L'app registra ${eurText(REGISTER_EXTRA_CENTS)}\\s+€ in meno della cassa`),
      );
    });

    await test.step("7b Pranzo and Cena", async () => {
      // The tables opened at the wall-clock time, so their service is whatever the clock made it; the owner places them (M25c, ADR-031).
      for (const index of A_TABLES) await setTableService(page, sessions[index]!, "pranzo");
      for (const index of B_TABLES) await setTableService(page, sessions[index]!, "cena");
      const split = await dayServices(page, day);
      expect(split.final).toBe(false);
      const pranzo = split.services.find((service) => service.key === "pranzo")!;
      const cena = split.services.find((service) => service.key === "cena")!;
      expect(pranzo.tables).toBe(3);
      expect(pranzo.covers).toBe(A_TABLES.reduce((sum, index) => sum + COVERS[index]!, 0));
      expect(cena.tables).toBe(3);
      expect(cena.covers).toBe(B_TABLES.reduce((sum, index) => sum + COVERS[index]!, 0));
      expect(split.services.reduce((sum, service) => sum + cents(service.totalEur), 0)).toBe(
        totalCents,
      );
      expect(cents(split.total.totalEur)).toBe(totalCents);

      await page.reload();
      await expect(main(page)).toContainText(
        new RegExp(`Totale app ${eurText(totalCents)}\\s+€ · 6 tavoli · ${TOTAL_COVERS} coperti`),
      );
      await expect(main(page)).toContainText(
        new RegExp(`L'app registra ${eurText(REGISTER_EXTRA_CENTS)}\\s+€ in meno della cassa`),
      );
    });

    await test.step("8 reports", async () => {
      const kpis = await getJson<{
        current: {
          covers: number;
          tables: number;
          appVsRegister: { appTotalEur: number; registerTotalEur: number | null };
        };
      }>(page, `/api/reports/kpis?period=day&date=${day}`);
      expect(kpis.current.covers).toBe(TOTAL_COVERS);
      expect(kpis.current.tables).toBe(6);
      expect(cents(kpis.current.appVsRegister.appTotalEur)).toBe(totalCents);
      expect(cents(kpis.current.appVsRegister.registerTotalEur ?? 0)).toBe(
        totalCents + REGISTER_EXTRA_CENTS,
      );

      const report = await getJson<{
        app: { total: number };
        register: { total: number } | null;
        difference: { amount: number; pct: number | null } | null;
        missingReceipts: { sessionId: string }[];
        openTables: { count: number };
        lateOps: { count: number };
      }>(page, `/api/reports/app-vs-register?date=${day}`);
      expect(cents(report.app.total)).toBe(totalCents);
      expect(cents(report.register?.total ?? 0)).toBe(totalCents + REGISTER_EXTRA_CENTS);
      expect(cents(report.difference?.amount ?? 0)).toBe(-REGISTER_EXTRA_CENTS);
      expect(Math.abs(report.difference?.pct ?? 100)).toBeLessThan(5);
      expect(report.missingReceipts.map((row) => row.sessionId)).toEqual([sessions[5]]);
      expect(report.openTables.count).toBe(0);
      expect(report.lateOps.count).toBe(0);

      await page.goto(`/report?vista=andamento&periodo=giorno&data=${day}`);
      await expect(main(page).getByRole("heading", { name: "Report", exact: true })).toBeVisible();
      await expect(main(page).locator('[data-kpi="covers"]')).toContainText(String(TOTAL_COVERS));
    });

    await test.step("9 invariants", async () => {
      expect(ledgerFindings(tenantId)).toEqual([]);

      // Balances are produced minus sold: 20 - 16 portions in each batch, and 12 kg of beef minus what the two productions used.
      const list = await getJson<{ items: { batchId: string; recipeName: string }[] }>(
        page,
        "/api/batches",
      );
      for (const name of [STEW, RAGU]) {
        const batch = list.items.find((item) => item.recipeName === name);
        expect(batch, `${name} has a batch`).toBeDefined();
        const detail = await getJson<{ portionsRemaining: number }>(
          page,
          `/api/batches/${batch!.batchId}`,
        );
        expect(detail.portionsRemaining).toBe(PORTIONS - TOTAL_COVERS);
      }
      const stock = await getJson<{ items: { name: string; onHandQty: number }[] }>(
        page,
        "/api/stock",
      );
      expect(stock.items.find((item) => item.name === BEEF)?.onHandQty).toBeCloseTo(
        INVOICE_KG * 2 - STEW_BEEF_KG - RAGU_BEEF_KG,
        4,
      );

      // Under the nonce policy, the offline replay and the service worker included, nothing was blocked.
      expect(collectors.flatMap((collector) => collector.violations)).toEqual([]);
    });

    await Promise.all([chef.context.close(), a.context.close(), b.context.close()]);
  });
});
