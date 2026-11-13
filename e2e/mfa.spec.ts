import { devices, expect, test, type Browser, type Page } from "@playwright/test";
import { collectCspViolations } from "./helpers/csp";
import { latestLinkFor } from "./helpers/mailbox";
import {
  appUserId,
  Authenticator,
  enrolOnScreen,
  passChallenge,
  setEnforcement,
} from "./helpers/mfa";
import { createWaiter, PLATE, seedPlateRecipe, seedTables } from "./helpers/seed-menu-tables";
import { admin, tenantIdOf } from "./helpers/seed-invoice";
import {
  createOwner,
  createStaff,
  expectPhoneFriendly,
  MAILPIT_URL,
  requireSupabaseStack,
  setFixturePassword,
  setStaffPassword,
  signInWithMagicLink,
  waitForHydration,
} from "./helpers/session";

requireSupabaseStack();

// P2-1 B8: the second factor for the owner and the admin, on screen, at phone size (360 px). Codes come from e2e/helpers/totp.ts (A14), so no authenticator app is
// needed; enforcement is set with the local stack's service key (the founder's M-5 step), the one way the app never offers (Q-T1 = V1: no in-app reset either). Fresh
// tenants and fake data only. The tenant default is 'enrolled', so a first owner sign-in lands on the offer page. The waiter proves MFA never touches staff.
const main = (page: Page) => page.locator("main");

/** A fresh phone-sized context: a different device with its own cookies. */
async function freshPhone(browser: Browser) {
  const context = await browser.newContext({
    ...devices["Pixel 7"],
    viewport: { width: 360, height: 740 },
    baseURL: test.info().project.use.baseURL,
  });
  return { context, page: await context.newPage() };
}

/** Requests the magic link and visits it, waiting for the page the sign-in lands on (the offer, the code or the forced page, depending on the second factor). */
async function signInByLink(page: Page, email: string, expectUrl: RegExp): Promise<void> {
  await page.goto("/login");
  await waitForHydration(page);
  await main(page).getByLabel("Email", { exact: true }).fill(email);
  await main(page).getByRole("button", { name: "Inviami il link", exact: true }).click();
  await expect(main(page).getByRole("status")).toContainText("riceverai un'email");
  await page.goto(await latestLinkFor(MAILPIT_URL!, email));
  await page.waitForURL(expectUrl);
}

/** Signs in a first-time owner or admin from the offer page and enrols the main factor, skipping the backup; returns the authenticator for the sign-in challenge. */
async function signInAndEnrol(page: Page, email: string): Promise<Authenticator> {
  await signInByLink(page, email, /\/login\/offerta-codice/);
  await main(page).getByRole("button", { name: "Attiva ora", exact: true }).click();
  await expect(main(page).getByAltText("Codice QR per l'app di autenticazione")).toBeVisible();
  const device = await enrolOnScreen(page);
  await main(page).getByRole("button", { name: "Più tardi", exact: true }).click();
  await page.waitForURL((url) => url.pathname === "/");
  return device;
}

/** Signs in on /login with e-mail and password (a client-side sign-in) and waits for the page `expectUrl` names. Unlike signInWithPassword it never skips the offer. */
async function signInByPassword(
  page: Page,
  email: string,
  password: string,
  expectUrl: RegExp,
): Promise<void> {
  await page.goto("/login");
  const submit = main(page).getByRole("button", { name: "Accedi con la password", exact: true });
  await waitForHydration(page);
  await expect(submit).toBeEnabled();
  await main(page).getByLabel("Email", { exact: true }).fill(email);
  await main(page).getByLabel("Password", { exact: true }).fill(password);
  await submit.click();
  await page.waitForURL(expectUrl);
}

/**
 * The QR is on screen AND the browser decoded it: a `data:` image the CSP blocks is still in the DOM (and visible as an alt box), but never loads.
 * `naturalWidth` stays 0 for a blocked or broken image.
 */
async function expectQrLoaded(page: Page): Promise<void> {
  const qr = main(page).getByAltText("Codice QR per l'app di autenticazione");
  await expect(qr).toBeVisible();
  await expect
    .poll(() => qr.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0))
    .toBe(true);
}

async function signOut(page: Page): Promise<void> {
  await page.goto("/altro");
  await main(page).getByRole("button", { name: "Esci", exact: true }).click();
  await page.waitForURL(/\/login/);
}

test.describe("TOTP for the owner and the admin (360 px)", () => {
  test("an owner turns on the code, signs out and in, and passes it", async ({ page, context }) => {
    const csp = await collectCspViolations(context);
    const email = createOwner();

    // First sign-in (tenant default 'enrolled'): the owner is offered the code, not forced.
    await signInByLink(page, email, /\/login\/offerta-codice/);
    await expect(
      main(page).getByRole("heading", { name: "Proteggi il tuo accesso", exact: true }),
    ).toBeVisible();
    await expectPhoneFriendly(page);

    await main(page).getByRole("button", { name: "Attiva ora", exact: true }).click();
    await expect(main(page).getByAltText("Codice QR per l'app di autenticazione")).toBeVisible();
    await expectPhoneFriendly(page);
    // No CSP violation on the QR page: the data: image is allowed here only (B1).
    expect(csp.violations).toEqual([]);

    const device = await enrolOnScreen(page);
    await main(page).getByRole("button", { name: "Più tardi", exact: true }).click();
    await page.waitForURL((url) => url.pathname === "/");

    await signOut(page);

    // Second sign-in: now the code is required.
    await signInByLink(page, email, /\/login\/codice/);
    await expect(
      main(page).getByRole("heading", { name: "Codice di verifica", exact: true }),
    ).toBeVisible();
    await expectPhoneFriendly(page);

    // A wrong code is refused with the exact message.
    await main(page).getByLabel("Codice di 6 cifre", { exact: true }).fill("000000");
    await main(page).getByRole("button", { name: "Verifica", exact: true }).click();
    await expect(
      main(page).getByText(
        "Codice non valido. Controlla che l'ora del telefono sia giusta e riprova.",
      ),
    ).toBeVisible();

    // The right code lands on Oggi.
    await passChallenge(page, device);
    await page.waitForURL((url) => url.pathname === "/");
    await expect(page.getByTestId("role")).toHaveText("Ruolo: Titolare");
    expect(csp.violations).toEqual([]);
  });

  test("required is refused until the admin has a factor, then forces a reset admin to enrol; the list has no reset", async ({
    browser,
  }) => {
    const ownerPhone = await freshPhone(browser);
    const ownerEmail = createOwner();
    await signInAndEnrol(ownerPhone.page, ownerEmail);
    const tenantId = await tenantIdOf(ownerPhone.page);

    const adminEmail = await createStaff(tenantId, "admin");
    const adminActor = await appUserId(tenantId, "admin");

    // 'required' is refused while the admin has no factor (T-3).
    await expect(setEnforcement(tenantId, "required", adminActor)).rejects.toThrow(
      /admins_not_enrolled/,
    );

    // The admin enrols through the UI, then 'required' is accepted.
    const adminPhone = await freshPhone(browser);
    await signInAndEnrol(adminPhone.page, adminEmail);
    await setEnforcement(tenantId, "required", adminActor);

    // DigiAlto's break-glass reset (service role only) removes the admin's factors, so the next sign-in is forced to enrol.
    await admin().rpc("mfa_reset_service_begin", { p_user: adminActor, p_actor: adminActor });
    const authId = (await admin().from("app_user").select("auth_id").eq("id", adminActor).single())
      .data!.auth_id as string;
    for (const factor of (await admin().auth.admin.mfa.listFactors({ userId: authId })).data!
      .factors)
      await admin().auth.admin.mfa.deleteFactor({ userId: authId, id: factor.id });

    // A fresh admin sign-in with no factor, mode required: forced to /login/attiva-codice.
    const forced = await freshPhone(browser);
    await signInByLink(forced.page, adminEmail, /\/login\/attiva-codice/);
    await expect(
      forced.page
        .locator("main")
        .getByRole("heading", { name: "Attiva la verifica in due passaggi", exact: true }),
    ).toBeVisible();
    await expectPhoneFriendly(forced.page);

    // The owner's /doppia-verifica lists the admin with no reset button, only the DigiAlto text.
    await ownerPhone.page.goto("/doppia-verifica");
    const list = ownerPhone.page.locator("main");
    await expect(
      list.getByRole("heading", { name: "Verifica in due passaggi", exact: true }),
    ).toBeVisible();
    await expect(list.getByText("admin Demo", { exact: false })).toBeVisible();
    await expect(list.getByText(/contatta DigiAlto/)).toBeVisible();
    await expect(list.getByRole("button", { name: /azzer|reset/i })).toHaveCount(0);
    await expectPhoneFriendly(ownerPhone.page);

    for (const phone of [ownerPhone, adminPhone, forced]) await phone.context.close();
  });

  // The CSP follows the fully loaded document, so each way into a QR page has its own test: the page must be entered as a new document,
  // and the QR must really load (naturalWidth), with no violation reported (T-12).
  test("an owner who signs in by password is offered the code and the QR loads after Attiva ora", async ({
    page,
    context,
  }) => {
    const csp = await collectCspViolations(context);
    const email = createOwner();
    const password = await setFixturePassword(email);

    // A client-side sign-in: /login's document had no data: images, so the offer page has to be a new document.
    await signInByPassword(page, email, password, /\/login\/offerta-codice/);
    await expect(
      main(page).getByRole("heading", { name: "Proteggi il tuo accesso", exact: true }),
    ).toBeVisible();
    await main(page).getByRole("button", { name: "Attiva ora", exact: true }).click();
    await expectQrLoaded(page);
    expect(csp.violations).toEqual([]);
  });

  test("a backup device is added from the factor list, reached through the nav", async ({
    page,
    context,
  }) => {
    const csp = await collectCspViolations(context);
    await signInAndEnrol(page, createOwner());

    // signInAndEnrol ends on a document that already allows data: images, which would hide a client navigation. Start from a fresh
    // document (Oggi at "/", no data:) and go Altro, then the row. The row must be a real document load: a marker set on the old
    // document is gone afterwards.
    await page.goto("/");
    const tabs = page.locator('nav[data-slot="bottom-tabs"]');
    await expect(tabs).toBeVisible();
    await page.evaluate(() => {
      (window as unknown as { __marker?: number }).__marker = 1;
    });
    await tabs.getByRole("link", { name: "Altro", exact: true }).click();
    await page.waitForURL((url) => url.pathname === "/altro");
    // The Altro tab is a client navigation, so the marker survives: this proves the page was hydrated, so the next click would be a
    // client navigation if the row were a <Link>.
    expect(await page.evaluate(() => (window as unknown as { __marker?: number }).__marker)).toBe(
      1,
    );
    await main(page).getByRole("link", { name: "Verifica in due passaggi", exact: true }).click();
    await page.waitForURL((url) => url.pathname === "/doppia-verifica");
    await expect(
      main(page).getByRole("heading", { name: "Verifica in due passaggi", exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(() => (window as unknown as { __marker?: number }).__marker),
    ).toBeUndefined();

    await main(page).getByRole("button", { name: "Aggiungi", exact: true }).click();
    await expectQrLoaded(page);
    expect(csp.violations).toEqual([]);

    await enrolOnScreen(page);
    await expect(main(page).getByText(/attivo dal/)).toHaveCount(2);
    expect(csp.violations).toEqual([]);
  });

  test("an admin under required who signs in by password lands on the forced enrolment with the QR loaded", async ({
    browser,
  }) => {
    const ownerPhone = await freshPhone(browser);
    await signInAndEnrol(ownerPhone.page, createOwner());
    const tenantId = await tenantIdOf(ownerPhone.page);
    const adminEmail = await createStaff(tenantId, "admin");
    const adminActor = await appUserId(tenantId, "admin");

    // 'required' needs an enrolled admin (T-3); then DigiAlto's break-glass reset removes the factor, so the next sign-in is forced to enrol.
    const adminPhone = await freshPhone(browser);
    await signInAndEnrol(adminPhone.page, adminEmail);
    await setEnforcement(tenantId, "required", adminActor);
    await admin().rpc("mfa_reset_service_begin", { p_user: adminActor, p_actor: adminActor });
    const authId = (await admin().from("app_user").select("auth_id").eq("id", adminActor).single())
      .data!.auth_id as string;
    for (const factor of (await admin().auth.admin.mfa.listFactors({ userId: authId })).data!
      .factors)
      await admin().auth.admin.mfa.deleteFactor({ userId: authId, id: factor.id });
    const password = await setStaffPassword(adminEmail);

    const forced = await freshPhone(browser);
    const csp = await collectCspViolations(forced.context);
    await signInByPassword(forced.page, adminEmail, password, /\/login\/attiva-codice/);
    await expect(
      main(forced.page).getByRole("heading", {
        name: "Attiva la verifica in due passaggi",
        exact: true,
      }),
    ).toBeVisible();
    await expectQrLoaded(forced.page);
    expect(csp.violations).toEqual([]);

    for (const phone of [ownerPhone, adminPhone, forced]) await phone.context.close();
  });

  test("a waiter takes an order throughout and never sees an MFA page", async ({
    page,
    browser,
  }) => {
    const ownerEmail = createOwner();
    await signInAndEnrol(page, ownerEmail);
    const tenantId = await tenantIdOf(page);

    await seedPlateRecipe(page, tenantId);
    const menu = await page.request.post("/api/menu/items", {
      data: { name: PLATE, priceEuro: 12 },
    });
    expect(menu.status()).toBe(201);
    const tables = await seedTables(page, ["Tavolo 1 (demo)"]);

    const waiterEmail = await createWaiter(tenantId, "Cameriere Demo");
    const w = await freshPhone(browser);
    await signInWithMagicLink(w.page, waiterEmail, "/tavoli");
    // No MFA page on the way in: the waiter landed straight on the tables.
    expect(new URL(w.page.url()).pathname).toBe("/tavoli");

    await w.page.locator(`[data-table-id="${tables["Tavolo 1 (demo)"]}"]`).click();
    await w.page.getByLabel("Coperti", { exact: true }).fill("2");
    await w.page.getByRole("button", { name: "Apri tavolo", exact: true }).click();
    await w.page.waitForURL(/\/tavoli\/comanda\?s=/);
    expect(new URL(w.page.url()).pathname).toBe("/tavoli/comanda");
    await w.context.close();
  });
});
