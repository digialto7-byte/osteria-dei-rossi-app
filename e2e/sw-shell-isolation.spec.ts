import { expect, test, type Page } from "@playwright/test";
import { openTableOffline, serviceWorkerReady } from "./helpers/offline";
import { seedFiringCatalogue } from "./helpers/seed-firing";
import { seedTables, WAITER_A } from "./helpers/seed-menu-tables";
import { tenantIdOf } from "./helpers/seed-invoice";
import {
  createOwner,
  requireSupabaseStack,
  signInWithMagicLink,
  waitForHydration,
} from "./helpers/session";

requireSupabaseStack();

// A shared phone changes user: the worker's cached shell pages (/, /tavoli, /tavoli/comanda) must not carry the owner's render over to
// the waiter who signs in by PIN next. The comanda's HTML used to depend on ?s=, so offline the worker served a copy rendered for
// another session and React threw hydration error #418. Chromium (`phone`) only: the worker is blocked on `phone-webkit`. Fake data only.
//
// What fails on the old worker and comanda page (and so what this spec really asserts):
//   1. the shell pages are REPLACED after the PIN login (each stored copy's `date` is later than the moment just before the login;
//      the old worker did nothing then, so the precached no-?s comanda, the copy that threw #418, still predated it);
//   2. no hydration error on a comanda opened offline with a ?s the cache never rendered.
// The shell carries no user data by design (the pages are static HTML, the user comes from /api/me), so the owner-name, nav-link and
// "€" checks at the end cannot catch a leak on their own; they only guard the rendered result. The real assertions are the replaced-
// after-PIN check and the no-#418 check.

const OWNER_NAME = "Titolare Demo"; // the owner's display name set by createOwner (helpers/session.ts)
const TABLE = "Tavolo 1 (demo)";
const DEVICE = "Telefono sala (demo)";
const PIN = "4827";
const HYDRATION_ERROR = /#418|Hydration failed|hydrat/i;

/** The addresses of the pages in the worker's shell cache, read from the page. */
const shellUrls = (page: Page) =>
  page.evaluate(async () => {
    const found: string[] = [];
    for (const name of (await caches.keys()).filter((n) => n.startsWith("shell-"))) {
      for (const request of await (await caches.open(name)).keys()) found.push(request.url);
    }
    return found;
  });

/** The `date` header of each page in the shell cache, in ms (the time the server answered), by address. */
const shellDates = (page: Page) =>
  page.evaluate(async () => {
    const found: Record<string, number> = {};
    for (const name of (await caches.keys()).filter((n) => n.startsWith("shell-"))) {
      const cache = await caches.open(name);
      for (const request of await cache.keys()) {
        const date = (await cache.match(request))?.headers.get("date");
        found[request.url] = date ? Date.parse(date) : Number.NaN;
      }
    }
    return found;
  });

test.describe("the service worker shell across a change of user on a phone (360 px)", () => {
  test.setTimeout(300_000);

  test("a waiter who signs in by PIN after the owner is served no trace of the owner offline", async ({
    page,
  }) => {
    // --- The owner: seeds a waiter with a PIN and an enrolment code, then loads the three shell pages online ------------------
    await signInWithMagicLink(page, createOwner());
    const tenantId = await tenantIdOf(page);
    await seedFiringCatalogue(page, tenantId);
    const tables = await seedTables(page, [TABLE]);
    const waiter = await page.request.post("/api/users", {
      data: { displayName: WAITER_A, role: "waiter", pin: PIN },
    });
    expect(waiter.status()).toBe(201);
    const made = await page.request.post("/api/devices/enrolment-codes", {
      data: { label: DEVICE },
    });
    expect(made.status()).toBe(201);
    const { code } = (await made.json()) as { code: string };

    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await serviceWorkerReady(page);
    await page.goto("/tavoli");
    await page.waitForLoadState("networkidle");
    await expect(page.getByText(OWNER_NAME).first()).toBeVisible();
    // The owner never opens a comanda: the cached one is the worker's own precache (no ?s), the copy that threw #418 on the old code.
    await expect
      .poll(() => shellUrls(page), { message: "the shell holds the owner's three pages" })
      .toEqual(
        expect.arrayContaining([
          `${new URL(page.url()).origin}/`,
          `${new URL(page.url()).origin}/tavoli`,
          `${new URL(page.url()).origin}/tavoli/comanda`,
        ]),
      );

    // --- The owner logs out; the same phone is enabled for staff and a waiter signs in by PIN ---------------------------------
    await page.goto("/tavoli");
    await page.getByRole("button", { name: "Esci", exact: true }).click();
    await page.waitForURL(/\/login/);
    await page.goto("/dispositivo");
    await waitForHydration(page);
    await page.locator("#code").fill(code);
    await page.getByRole("button", { name: "Abilita", exact: true }).click();
    await page.waitForURL((url) => url.pathname === "/login");
    const personButton = page.getByRole("button", { name: WAITER_A });
    await expect(personButton).toBeVisible();
    await personButton.click();
    await waitForHydration(page);
    await page.getByLabel("PIN", { exact: true }).fill(PIN);
    // The server's `date` header has a resolution of one second.
    const beforePin = Math.floor(Date.now() / 1000) * 1000;
    await page.getByRole("button", { name: "Entra", exact: true }).click();
    await page.waitForURL((url) => url.pathname === "/tavoli");
    await expect(page.getByRole("heading", { name: "Tavoli", exact: true })).toBeVisible();
    await page.waitForLoadState("networkidle");
    await serviceWorkerReady(page); // the waiter's reads are stored by now
    // The worker fetched the pages again for the waiter after the PIN login's clear: all three are there, and each was served after
    // the moment just before the login. The old worker did nothing at the login, so its copies are the owner's, served long before.
    const origin = new URL(page.url()).origin;
    await expect
      .poll(
        async () => {
          const dates = await shellDates(page);
          return ["/", "/tavoli", "/tavoli/comanda"].every(
            (path) => (dates[`${origin}${path}`] ?? 0) >= beforePin,
          );
        },
        { message: "the shell was filled again for the waiter, after the PIN login" },
      )
      .toBe(true);

    // --- No connection: a new table's comanda opens from the worker's copy, and the home page shows nothing of the owner ----------
    const problems: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") problems.push(message.text());
    });
    page.on("pageerror", (error) => problems.push(error.message));

    await openTableOffline(page, tables[TABLE]!, 2);
    await expect(page.getByRole("heading", { name: TABLE, exact: true })).toBeVisible();
    await expect(page.getByText(OWNER_NAME)).toHaveCount(0);

    await page.goto("/");
    // A waiter's home redirects client-side to /tavoli once it has read /api/me: wait for that, not for a fixed time.
    await page.waitForURL((url) => url.pathname === "/tavoli");
    await expect(page.getByRole("heading", { name: "Tavoli", exact: true })).toBeVisible();
    await expect(page.getByText(OWNER_NAME)).toHaveCount(0);
    for (const name of ["Fatture", "Report", "Costi dei piatti"]) {
      await expect(page.getByRole("link", { name }), `no "${name}" link`).toHaveCount(0);
    }
    expect(await page.locator("body").innerText(), "no amount on the home page").not.toContain("€");

    expect(
      problems.filter((text) => HYDRATION_ERROR.test(text)),
      "no hydration error across the offline pages",
    ).toEqual([]);
  });
});
