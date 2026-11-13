import { expect, test, type Page } from "@playwright/test";
import { latestCodeFor } from "./helpers/mailbox";
import {
  createOwner,
  expectPhoneFriendly,
  MAILPIT_URL,
  requireSupabaseStack,
  setFixturePassword,
  signInWithPassword,
  waitForHydration,
} from "./helpers/session";

requireSupabaseStack();

// M25a: owner and admin sign in with e-mail and password on /login; the e-mail link (with its 6-digit code) is the
// fallback and the only way to a first or a forgotten password. Phone project only. Every owner is made fresh with fake
// data, and the password is made at run time. Budget: Auth's sign-in bucket is shared with the PIN logins, so this
// file makes 3 password grants (one sign-in, one wrong attempt, one re-sign-in on the server after "Salva password"),
// and session-persistence.spec.ts one more: 4 per browser project.

const main = (page: Page) => page.locator("main");

async function expectPhoneFriendlyBothThemes(page: Page) {
  await expectPhoneFriendly(page);
  await page.emulateMedia({ colorScheme: "dark" });
  await expectPhoneFriendly(page);
  await page.emulateMedia({ colorScheme: "light" });
}

test.describe("owner password sign-in on a phone (360 px)", () => {
  test("an owner signs in with e-mail and password and lands on Oggi", async ({ page }) => {
    const email = createOwner();
    const password = await setFixturePassword(email);
    await signInWithPassword(page, email, password);
    await expect(page.getByTestId("role")).toHaveText("Ruolo: Titolare");
    // A password session: the account card offers to change it, not to set it.
    await expect(
      main(page).getByRole("link", { name: "Cambia password", exact: true }),
    ).toBeVisible();
    await expect(
      main(page).getByRole("link", { name: "Imposta una password", exact: true }),
    ).toHaveCount(0);
  });

  test("a wrong password shows the one generic message", async ({ page }) => {
    const email = createOwner();
    await page.goto("/login");
    await waitForHydration(page);
    await main(page).getByLabel("Email", { exact: true }).fill(email);
    await main(page).getByLabel("Password", { exact: true }).fill("una password sbagliata");
    await main(page).getByRole("button", { name: "Accedi con la password", exact: true }).click();
    await expect(main(page).getByRole("alert")).toHaveText("Email o password non corretti.");
    await expect(page).toHaveURL((url) => url.pathname === "/login");
  });

  test("a new owner signs in with the e-mail code, chooses a password and is on Oggi", async ({
    page,
  }) => {
    const email = createOwner();
    await page.goto("/login");
    await expect(main(page).getByRole("heading", { name: "Accedi", exact: true })).toBeVisible();
    await expectPhoneFriendlyBothThemes(page);
    await waitForHydration(page);

    await main(page).getByLabel("Email", { exact: true }).fill(email);
    await main(page).getByRole("button", { name: "Inviami il link", exact: true }).click();
    await expect(main(page).getByRole("status")).toContainText("riceverai un'email");
    const code = await latestCodeFor(MAILPIT_URL!, email);
    await main(page).getByLabel("Codice di 6 cifre", { exact: true }).fill(code);
    await main(page).getByRole("button", { name: "Entra con il codice", exact: true }).click();

    // P2-1 B4: an owner with no second factor is offered one first; "Non ora" goes on to the password page this sign-in owes.
    await page.waitForURL((url) => url.pathname === "/login/offerta-codice");
    expect(new URL(page.url()).searchParams.get("next")).toBe("/password?dopo=%2F");
    await main(page).getByRole("button", { name: "Non ora", exact: true }).click();
    await page.waitForURL(
      (url) => url.pathname === "/password" && url.searchParams.get("dopo") === "/",
    );
    await expect(main(page).getByRole("heading", { name: "Password", exact: true })).toBeVisible();
    // Signed in just now: no current password is asked.
    await expect(main(page).getByLabel("Nuova password", { exact: true })).toBeVisible();
    await expect(main(page).getByLabel("Password attuale", { exact: true })).toHaveCount(0);
    await expectPhoneFriendlyBothThemes(page);

    await waitForHydration(page);
    await main(page)
      .getByLabel("Nuova password", { exact: true })
      .fill("una frase lunga per il locale");
    await main(page).getByRole("button", { name: "Salva password", exact: true }).click();
    await page.waitForURL((url) => url.pathname === "/");
    // The prompt is gone: this device is now a password session.
    await expect(
      main(page).getByRole("link", { name: "Cambia password", exact: true }),
    ).toBeVisible();
  });
});
