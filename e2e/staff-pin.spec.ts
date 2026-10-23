import { devices, expect, test, type Browser, type Page } from "@playwright/test";
import {
  createOwner,
  expectPhoneFriendly,
  requireSupabaseStack,
  signInWithMagicLink,
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
  page.getByRole("alert").filter({ hasText: text });
const rowOf = (page: Page, name: string) => page.getByRole("listitem").filter({ hasText: name });

/** Taps a person on /pin, types a PIN and presses "Entra". */
async function enterPin(page: Page, pin: string, person = NAME) {
  if (await page.getByRole("button", { name: person }).isVisible()) {
    await page.getByRole("button", { name: person }).click();
  }
  await page.getByLabel("PIN", { exact: true }).fill(pin);
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
    await device.locator("#code").fill(code);
    await device.getByRole("button", { name: "Abilita", exact: true }).click();
    await expect(
      device.getByRole("status").filter({ hasText: `Dispositivo abilitato: ${DEVICE}.` }),
    ).toBeVisible();

    // Now "/" redirects to the PIN screen.
    await device.goto("/");
    await expect(device).toHaveURL(/\/pin$/);
    await expect(device.getByRole("heading", { name: "Chi sei?", exact: true })).toBeVisible();
    await expectPhoneFriendlyBothThemes(device);

    // AT4 UI: a third phone with the same code is refused.
    const stranger = await newPhone(browser);
    await stranger.page.goto("/dispositivo");
    await stranger.page.locator("#code").fill(code);
    await stranger.page.getByRole("button", { name: "Abilita", exact: true }).click();
    await expect(alertWith(stranger.page, "Codice non valido o scaduto")).toBeVisible();
    await stranger.context.close();

    // --- Device: AT1 UI, a wrong PIN and then the right one -------------------------------------------
    await device.getByRole("button", { name: NAME }).click();
    await device.getByLabel("PIN", { exact: true }).fill("0000");
    await device.getByRole("button", { name: "Entra", exact: true }).click();
    await expect(alertWith(device, "PIN errato. Tentativi rimasti: 4.")).toBeVisible();
    await expect(device.getByLabel("PIN", { exact: true })).toHaveValue("");

    await device.getByLabel("PIN", { exact: true }).fill(GOOD_PIN);
    await device.getByRole("button", { name: "Entra", exact: true }).click();
    await device.waitForURL((url) => url.pathname === "/");
    const me = await device.request.get("/api/me");
    expect(me.status()).toBe(200);
    expect((await me.json()).user.role).toBe("waiter");

    // --- Device: AT3 UI, five wrong PINs lock the person ----------------------------------------------
    await device.goto("/pin");
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
    await pinForm.locator('input[name="pin"]').fill(NEW_PIN);
    await pinForm.locator('input[name="repeat"]').fill(NEW_PIN);
    await pinForm.getByRole("button", { name: "Salva PIN", exact: true }).click();
    await expect(
      page.getByRole("status").filter({ hasText: `PIN aggiornato per ${NAME}.` }),
    ).toBeVisible();

    // AT6 UI: the old PIN no longer works, the new one does.
    await device.goto("/pin");
    await enterPin(device, GOOD_PIN);
    await expect(alertWith(device, "PIN errato.")).toBeVisible();
    await enterPin(device, NEW_PIN);
    await device.waitForURL((url) => url.pathname === "/");

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

    // The device's next page that calls /api/* lands on the PIN screen, no longer enabled.
    await device.goto("/");
    await expect(device).toHaveURL(/\/pin$/);
    await expect(
      device.getByRole("heading", { name: "Questo dispositivo non è abilitato.", exact: true }),
    ).toBeVisible();
    await phone.context.close();
  });

  test("the owner lists stay within the page column on a laptop (1280 x 800)", async ({ page }) => {
    await signInWithMagicLink(page, createOwner());
    await page.setViewportSize({ width: 1280, height: 800 });
    for (const path of ["/personale", "/dispositivi"]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      const main = await page.locator("main").boundingBox();
      expect(main?.width ?? 0).toBeLessThanOrEqual(448);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    }
  });
});
