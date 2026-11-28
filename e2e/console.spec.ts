import { expect, test, type Page } from "@playwright/test";
import { quoteUuid, runSql } from "../tests/integration/helpers/sql";
import { enrolOnScreen } from "./helpers/mfa";
import { admin } from "./helpers/seed-invoice";
import { createTwoVenueOwner, VENUE_A, VENUE_B } from "./helpers/seed-memberships";
import { fakeEmail, requireSupabaseStack, waitForHydration } from "./helpers/session";

requireSupabaseStack();

// SP3 step 23 (docs/plans/2026-11-15-sp3-console.md §5 step 23; AT1, AT6, AT12 screen half): the console on its own host. playwright.config.ts sets
// CONSOLE_HOST=127.0.0.1:3000 and APP_ORIGIN=http://localhost:3000, so the same server is the console on 127.0.0.1 and the venue app on localhost. Phone size, fake
// data only. The platform admin row this spec bootstraps is deactivated at the end (one active platform admin per database).
const CONSOLE = "http://127.0.0.1:3000";
const APP = "http://localhost:3000";
const main = (page: Page) => page.locator("main");

async function signInOnConsole(page: Page, email: string, password: string): Promise<void> {
  await page.goto(`${CONSOLE}/login`);
  const submit = main(page).getByRole("button", { name: "Accedi con la password", exact: true });
  await waitForHydration(page);
  await expect(submit).toBeEnabled();
  await main(page).getByLabel("Email", { exact: true }).fill(email);
  await main(page).getByLabel("Password", { exact: true }).fill(password);
  await submit.click();
}

test("AT6: console pages only on the console host, venue pages only on the app host", async ({
  request,
}) => {
  expect((await request.get(`${APP}/console/locali`)).status()).toBe(404);
  expect((await request.get(`${APP}/api/platform/tenants`)).status()).toBe(404);
  expect((await request.get(`${CONSOLE}/tavoli`)).status()).toBe(404);
  expect((await request.get(`${CONSOLE}/api/me`)).status()).toBe(404);
});

test("a venue owner on the console is signed out with «Questo account non ha accesso alla console.»", async ({
  page,
}) => {
  const venue = await createTwoVenueOwner();
  await signInOnConsole(page, venue.email, venue.password);
  await expect(main(page).getByRole("alert")).toHaveText(
    "Questo account non ha accesso alla console.",
  );
  expect(new URL(page.url()).pathname).toBe("/login");
});

test("the platform admin: first sign-in, enrolment, Locali with both venues, «Entra nel locale» to the app's chooser (AT1, AT12)", async ({
  page,
  context,
}) => {
  test.setTimeout(180_000);
  const venues = await createTwoVenueOwner();
  const db = admin();
  const email = fakeEmail("platform-admin");
  const password = `frase di prova ${crypto.randomUUID()}`;
  const created = await db.auth.admin.createUser({ email, password, email_confirm: true });
  const authId = created.data.user?.id;
  if (created.error || !authId) throw new Error("Fixture failed: platform admin");
  for (const tenantId of [venues.tenantA, venues.tenantB]) {
    const row = await db
      .from("app_user")
      .insert({ tenant_id: tenantId, auth_id: authId, role: "admin", display_name: "DigiAlto" });
    if (row.error) throw new Error("Fixture failed: admin row");
  }
  const boot = await db.rpc("platform_bootstrap_admin", { p_auth: authId });
  if (boot.error) throw new Error(`Fixture failed: bootstrap ${boot.error.code}`);

  try {
    // First sign-in: no factor yet, so the enrolment page; then the console's Locali (the shell switches into console mode itself).
    await signInOnConsole(page, email, password);
    await page.waitForURL(`${CONSOLE}/login/attiva-codice**`);
    await enrolOnScreen(page);
    await main(page).getByRole("button", { name: "Più tardi", exact: true }).click();
    await page.waitForURL(`${CONSOLE}/`);
    await expect(main(page).getByRole("heading", { level: 1, name: "Locali" })).toBeVisible();
    await expect(main(page).getByText(VENUE_A, { exact: true }).first()).toBeVisible();
    await expect(main(page).getByText(VENUE_B, { exact: true }).first()).toBeVisible();
    expect(
      await page.evaluate(
        async () => (await navigator.serviceWorker?.getRegistrations())?.length ?? 0,
      ),
    ).toBe(0);

    // A venue's detail: «Entra nel locale» asks first, then opens the app's chooser with that venue highlighted, in a new tab.
    await main(page)
      .getByRole("link", { name: new RegExp(VENUE_A) })
      .first()
      .click();
    await expect(main(page).getByRole("heading", { level: 1, name: VENUE_A })).toBeVisible();
    await main(page).getByRole("button", { name: "Entra nel locale", exact: true }).click();
    const opened = context.waitForEvent("page");
    await main(page).getByRole("button", { name: "Entra", exact: true }).click();
    const tab = await opened;
    await tab.waitForLoadState("domcontentloaded");
    expect(tab.url()).toBe(`${APP}/login/scegli-locale?locale=${venues.tenantA}`);
    await tab.close();
  } finally {
    runSql(`update platform.staff set is_active = false where auth_id = ${quoteUuid(authId)}`);
  }
});
