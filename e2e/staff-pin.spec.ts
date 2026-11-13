import { devices, expect, test, type Browser, type Page } from "@playwright/test";
import {
  createOwner,
  expectPhoneFriendly,
  requireSupabaseStack,
  signInWithMagicLink,
  waitForHydration,
} from "./helpers/session";

requireSupabaseStack();

// M11 acceptance tests on screen, at phone size (360 x 740): the owner adds a waiter and an enrolment
// code through /personale and /dispositivi; a second browser context plays the venue device (its own
// cookies, so it is a different phone). Fake data only: "Cameriere Demo", "Telefono sala (demo)".
// Overlapping names ("Cameriere" is a role word, a badge and part of a person's name) are matched with
// exact: true or scoped to a row; text that may also sit in an input is read from elements, not by text.

const NAME = "Cameriere Demo";
const DEVICE = "Telefono sala (demo)";
const GOOD_PIN = "4827";
const NEW_PIN = "7046";
const WRONG_PIN = "1357";

/** A fresh browser context at phone size: a different phone with no cookies. */
async function newPhone(browser: Browser) {
  const context = await browser.newContext({
    ...devices["Pixel 7"],
    viewport: { width: 360, height: 740 },
    baseURL: test.info().project.use.baseURL,
  });
  return { context, page: await context.newPage() };
}

async function expectPhoneFriendlyBothThemes(page: Page) {
  await expectPhoneFriendly(page);
  await page.emulateMedia({ colorScheme: "dark" });
  await expectPhoneFriendly(page);
  await page.emulateMedia({ colorScheme: "light" });
}

const alertWith = (page: Page, text: string | RegExp) =>
  page.locator("main").getByRole("alert").filter({ hasText: text });
const rowOf = (page: Page, name: string) => page.getByRole("listitem").filter({ hasText: name });

/** Taps a person on the staff screen of /login, types a PIN and presses "Entra". */
async function enterPin(page: Page, pin: string, person = NAME) {
  const personButton = page.getByRole("button", { name: person });
  const pinField = page.getByLabel("PIN", { exact: true });
  // isVisible() does not wait: right after a goto the list may not be rendered yet, and skipping the
  // tap would leave the test waiting for a PIN field that never appears. Wait for one of the two.
  await expect(personButton.or(pinField).first()).toBeVisible();
  if (await personButton.isVisible()) await personButton.click();
  await waitForHydration(page);
  await pinField.fill(pin);
  await page.getByRole("button", { name: "Entra", exact: true }).click();
}

test.describe("staff PIN login on a phone (360 px)", () => {
  test("the owner enrols a device and a waiter logs in with a PIN (AT1 to AT6 on screen)", async ({
    page,
    browser,
  }) => {
    test.setTimeout(180_000);

    // --- Owner: adds the waiter (AT6 UI: a trivial PIN is refused with the server's text) -------------
    await signInWithMagicLink(page, createOwner());
    await page.goto("/personale");
    await expect(page.getByRole("heading", { name: "Personale", exact: true })).toBeVisible();
    await expectPhoneFriendlyBothThemes(page);

    await page.locator('input[name="name"]').fill(NAME);
    await page.locator('input[name="pin"]').fill("1234");
    await page.locator('input[name="repeat"]').fill("1234");
    await page.getByRole("button", { name: "Aggiungi", exact: true }).click();
    await expect(alertWith(page, "PIN troppo semplice")).toBeVisible();

    await page.locator('input[name="pin"]').fill(GOOD_PIN);
    await page.locator('input[name="repeat"]').fill(GOOD_PIN);
    await page.getByRole("button", { name: "Aggiungi", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: `${NAME} aggiunto.` })).toBeVisible();
    await expect(rowOf(page, NAME)).toBeVisible();
    // Q10: no login time of a person on the staff list.
    await expect(page.locator("main")).not.toContainText(/ultimo accesso/i);

    // --- Owner: creates the enrolment code ---------------------------------------------------------
    await page.goto("/dispositivi");
    await expect(page.getByRole("heading", { name: "Dispositivi", exact: true })).toBeVisible();
    await expectPhoneFriendlyBothThemes(page);
    await page.locator('input[name="label"]').fill(DEVICE);
    await page.getByRole("button", { name: "Crea codice", exact: true }).click();
    const codeCard = page.getByRole("status").filter({ hasText: "Codice di abilitazione" });
    await expect(codeCard).toBeVisible();
    // The card says where to type the code (the page's own host), as text and never as a link.
    await expect(codeCard).toContainText(/Sul telefono da abilitare apri .+\/dispositivo/);
    await expect(codeCard.getByRole("link")).toHaveCount(0);
    const code = (await codeCard.locator("p.num").innerText()).replace("-", "");
    expect(code).toMatch(/^[0-9A-Z]{8}$/);

    // --- Device: no cookie yet, so "/" goes to the email login ---------------------------------------
    const phone = await newPhone(browser);
    const device = phone.page;
    await device.goto("/");
    await expect(device).toHaveURL(/\/login/);

    // AT4 UI: the code enables the device.
    await device.goto("/dispositivo");
    await expectPhoneFriendlyBothThemes(device);
    await waitForHydration(device);
    await device.locator("#code").fill(code);
    await device.getByRole("button", { name: "Abilita", exact: true }).click();
    // M25a: the enrolment goes straight to the staff screen, with no extra tap.
    await device.waitForURL((url) => url.pathname === "/login");
    await expect(
      device
        .locator("main")
        .getByRole("status")
        .filter({ hasText: `Telefono abilitato: ${DEVICE}.` }),
    ).toBeVisible();
    await expect(
      device.locator("main").getByRole("heading", { name: "Chi sei?", exact: true }),
    ).toBeVisible();

    // Now "/" redirects to the staff screen on /login.
    await device.goto("/");
    await expect(device).toHaveURL(/\/login$/);
    await expect(
      device.locator("main").getByRole("heading", { name: "Chi sei?", exact: true }),
    ).toBeVisible();
    await expectPhoneFriendlyBothThemes(device);

    // The owner's form is one tap away, behind a disclosure.
    const ownerToggle = device.locator("main").getByRole("button", {
      name: "Sei il titolare? Accedi con email",
      exact: true,
    });
    await expect(ownerToggle).toHaveAttribute("aria-expanded", "false");
    await expect(device.locator("main").getByLabel("Email", { exact: true })).toHaveCount(0);
    await ownerToggle.click();
    await expect(ownerToggle).toHaveAttribute("aria-expanded", "true");
    await expect(device.locator("main").getByLabel("Email", { exact: true })).toBeVisible();
    await ownerToggle.click();
    await expect(ownerToggle).toHaveAttribute("aria-expanded", "false");

    // AT4 UI: a third phone with the same code is refused.
    const stranger = await newPhone(browser);
    await stranger.page.goto("/dispositivo");
    await waitForHydration(stranger.page);
    await stranger.page.locator("#code").fill(code);
    await stranger.page.getByRole("button", { name: "Abilita", exact: true }).click();
    await expect(alertWith(stranger.page, "Codice non valido o scaduto")).toBeVisible();
    await stranger.context.close();

    // --- Device: AT1 UI, a wrong PIN and then the right one -------------------------------------------
    await device.getByRole("button", { name: NAME }).click();
    await waitForHydration(device);
    await device.getByLabel("PIN", { exact: true }).fill("0000");
    await device.getByRole("button", { name: "Entra", exact: true }).click();
    await expect(alertWith(device, "PIN errato. Tentativi rimasti: 4.")).toBeVisible();
    await expect(device.getByLabel("PIN", { exact: true })).toHaveValue("");

    await device.getByLabel("PIN", { exact: true }).fill(GOOD_PIN);
    await device.getByRole("button", { name: "Entra", exact: true }).click();
    // The waiter lands on the tables (the PIN reply carries the role), not on Oggi.
    await device.waitForURL((url) => url.pathname === "/tavoli");
    await expect(device.getByRole("heading", { name: "Tavoli", exact: true })).toBeVisible();
    const me = await device.request.get("/api/me");
    expect(me.status()).toBe(200);
    expect((await me.json()).user.role).toBe("waiter");

    // The header band carries the "Esci" (QW6): it ends the session and lands on the staff screen.
    await device.getByRole("button", { name: "Esci", exact: true }).click();
    await device.waitForURL((url) => url.pathname === "/login");
    expect((await device.request.get("/api/me")).status()).toBe(401);

    // --- Device: AT3 UI, five wrong PINs lock the person ----------------------------------------------
    // The old address still works: it redirects to /login (M25a).
    await device.goto("/pin");
    await expect(device).toHaveURL(/\/login$/);
    for (const left of [4, 3, 2, 1]) {
      await enterPin(device, WRONG_PIN);
      await expect(alertWith(device, `Tentativi rimasti: ${left}.`)).toBeVisible();
    }
    await enterPin(device, WRONG_PIN);
    await expect(alertWith(device, /Troppi tentativi\. Riprova alle \d{2}:\d{2}\./)).toBeVisible();

    // --- Owner: sees the lock, resets the PIN (which unlocks) -----------------------------------------
    await page.goto("/personale");
    await expect(rowOf(page, NAME)).toContainText(/Bloccato fino alle \d{2}:\d{2}/);
    await rowOf(page, NAME).getByRole("button", { name: "Cambia PIN", exact: true }).click();
    const pinForm = page.locator("form").filter({
      has: page.getByRole("button", { name: "Salva PIN", exact: true }),
    });
    await waitForHydration(page, pinForm);
    await pinForm.locator('input[name="pin"]').fill(NEW_PIN);
    await pinForm.locator('input[name="repeat"]').fill(NEW_PIN);
    await pinForm.getByRole("button", { name: "Salva PIN", exact: true }).click();
    await expect(
      page.getByRole("status").filter({ hasText: `PIN aggiornato per ${NAME}.` }),
    ).toBeVisible();

    // AT6 UI: the old PIN no longer works, the new one does.
    await device.goto("/login");
    await enterPin(device, GOOD_PIN);
    await expect(alertWith(device, "PIN errato.")).toBeVisible();
    await enterPin(device, NEW_PIN);
    await device.waitForURL((url) => url.pathname === "/tavoli");

    // --- Owner: revokes the device (AT2 UI) -------------------------------------------------------------
    await page.goto("/dispositivi");
    await rowOf(page, DEVICE).getByRole("button", { name: "Revoca", exact: true }).click();
    const confirm = page.getByRole("alertdialog");
    await expect(confirm).toContainText(`Revocare ${DEVICE}? Chi lo usa verrà disconnesso.`);
    // Set up before the click so the answer cannot be missed.
    const revoked = page.waitForResponse(
      (r) => r.request().method() === "DELETE" && /\/api\/devices\/[^/?]+$/.test(r.url()) && r.ok(),
    );
    await confirm.getByRole("button", { name: "Revoca", exact: true }).click();
    await revoked;
    // A failed API call shows an error banner: report that first, not a row that never changed.
    await expect(page.locator("main").getByRole("alert")).toHaveCount(0);
    await expect(rowOf(page, DEVICE)).toContainText("Revocato");

    // The revoked device still holds its cookie, so "/" lands on /login; the device call says it is no longer
    // enabled and the screen falls back to the owner's password view.
    await device.goto("/");
    await expect(device).toHaveURL(/\/login$/);
    await expect(
      device.locator("main").getByRole("heading", { name: "Accedi", exact: true }),
    ).toBeVisible();
    await expect(device.locator("main").getByRole("status")).toHaveText(
      "Questo dispositivo non è più abilitato. Chiedi al titolare di abilitarlo di nuovo.",
    );
    await phone.context.close();
  });

  test("a new staff phone reaches the enrolment from the login page (A7)", async ({ browser }) => {
    // A phone with no cookie is sent to /login by the proxy; it must find /dispositivo without typing the URL.
    const phone = await newPhone(browser);
    await phone.page.goto("/");
    await expect(phone.page).toHaveURL(/\/login/);
    await phone.page
      .getByRole("link", { name: "Abilita questo telefono per il personale" })
      .click();
    await expect(phone.page).toHaveURL((url) => url.pathname === "/dispositivo");
    await expect(
      phone.page.getByRole("heading", { name: "Abilita dispositivo", exact: true }),
    ).toBeVisible();
    await expectPhoneFriendly(phone.page);
    await phone.context.close();
  });

  test("the owner lists stay within the page column on a laptop (1280 x 800)", async ({ page }) => {
    await signInWithMagicLink(page, createOwner());
    await page.setViewportSize({ width: 1280, height: 800 });
    for (const path of ["/personale", "/dispositivi"]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      const main = await page.locator("main").boundingBox();
      // UX plan C7: a list page uses the list column, up to max-w-3xl (768 px).
      expect(main?.width ?? 0).toBeGreaterThan(448);
      expect(Math.abs((main?.width ?? 0) - 768)).toBeLessThan(1);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    }
  });
});
