import { expect, test, type Page } from "@playwright/test";
import { createTwoVenueOwner, VENUE_A, VENUE_B } from "./helpers/seed-memberships";
import { expectPhoneFriendly, requireSupabaseStack, waitForHydration } from "./helpers/session";

requireSupabaseStack();

// SP2 AT7 (docs/plans/2026-11-26-sp02-memberships.md §5 S11, §8): a login with two venues picks one on /login/scegli-locale, switches from the
// header, and the switch clears the worker's offline read cache BEFORE the first read of the other venue. Phone size (360 px), fake data only.
// The sequence under test is `switchTenant`: forgetUser, then POST /api/me/tenant, then forgetUser, then a full load. The POST is held here, so the
// cache is checked while no request of the new venue has happened yet.
const main = (page: Page) => page.locator("main");
const READ_CACHE = "api-user";

const cacheHolds = (page: Page) => page.evaluate((name) => caches.has(name), READ_CACHE);
const cachedMeNames = (page: Page) =>
  page.evaluate(async (name) => {
    if (!(await caches.has(name))) return [];
    const cache = await caches.open(name);
    const names: string[] = [];
    for (const request of await cache.keys()) {
      if (new URL(request.url).pathname !== "/api/me") continue;
      const reply = await cache.match(request);
      const body = (await reply?.json()) as { tenant?: { name?: string } } | undefined;
      names.push(body?.tenant?.name ?? "?");
    }
    return names;
  }, READ_CACHE);

async function signInToThePicker(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/login");
  const submit = main(page).getByRole("button", { name: "Accedi con la password", exact: true });
  await waitForHydration(page);
  await expect(submit).toBeEnabled();
  await main(page).getByLabel("Email", { exact: true }).fill(email);
  await main(page).getByLabel("Password", { exact: true }).fill(password);
  await submit.click();
  // Two memberships and no choice yet: the API answers 409 and the client goes to the chooser (the second-factor offer may come first).
  await page.waitForURL(/\/login\/(scegli-locale|offerta-codice)/);
  if (new URL(page.url()).pathname === "/login/offerta-codice") {
    await main(page).getByRole("button", { name: "Non ora", exact: true }).click();
  }
  await page.waitForURL(/\/login\/scegli-locale/);
}

test("a login with two venues picks one, switches from the header, and the read cache is cleared before the first read of the other venue (AT7)", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const owner = await createTwoVenueOwner();
  await signInToThePicker(page, owner.email, owner.password);

  // The chooser: one button per venue, the way back kept, phone friendly.
  await expect(main(page).getByRole("heading", { name: "Scegli il locale" })).toBeVisible();
  await expect(main(page).getByRole("button", { name: new RegExp(VENUE_A) })).toBeVisible();
  await expect(main(page).getByRole("button", { name: new RegExp(VENUE_B) })).toBeVisible();
  await expect(main(page).getByRole("button", { name: "Esci", exact: true })).toBeVisible();
  await expectPhoneFriendly(page);

  // Venue A: the worker takes control and stores A's /api/me.
  await main(page)
    .getByRole("button", { name: new RegExp(VENUE_A) })
    .click();
  await page.waitForURL((url) => url.pathname === "/");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null))
    .toBe(true);
  await page.reload();
  await expect.poll(() => cachedMeNames(page), { timeout: 20_000 }).toEqual([VENUE_A]);

  // The header shows the switcher (two venues) with A as the current venue.
  const header = page.locator("header");
  const switcher = header.getByRole("button", { name: new RegExp(`Cambia locale.*${VENUE_A}`) });
  await expect(switcher).toBeVisible();
  await expectPhoneFriendly(page);

  // Hold the switch POST: until it is released no request of venue B has happened, and A's copy must already be gone.
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route("**/api/me/tenant", async (route) => {
    await held;
    await route.continue();
  });
  await switcher.click();
  await header.getByRole("button", { name: new RegExp(VENUE_B) }).click();
  await expect
    .poll(() => cacheHolds(page), { message: "A's read cache is deleted before the POST" })
    .toBe(false);
  release();

  // B: a full load; the first read of B is stored on its own, and nothing of A is left.
  await expect(
    header.getByRole("button", { name: new RegExp(`Cambia locale.*${VENUE_B}`) }),
  ).toBeVisible({
    timeout: 20_000,
  });
  const me = await page.request.get("/api/me");
  expect(((await me.json()) as { tenant: { name: string } }).tenant.name).toBe(VENUE_B);
  const names = await cachedMeNames(page);
  expect(names).not.toContain(VENUE_A);
});
