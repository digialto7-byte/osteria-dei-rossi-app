import { randomUUID } from "node:crypto";
import { expect, test, type APIResponse, type Page } from "@playwright/test";
import { createOwner, requireSupabaseStack, signInWithMagicLink } from "./helpers/session";

// A tap on a sign-in form before React has hydrated it is a native form submit. A form with no method is a GET: the
// browser then writes the typed e-mail and password into the URL (history, server and proxy logs). Now every form
// with named fields is method="post", and the buttons that send a secret stay disabled until hydration. These specs
// run with JavaScript off, so the page stays exactly as the server sent it (the state of a phone before hydration).
//
// With the button disabled, Enter in a field submits nothing in a browser (a disabled default button blocks implicit
// submission). So the Enter tests prove no value reaches a URL, and the request tests send the POST a browser would
// have sent, to show what the server does with it: it must not answer 500 and must not echo the values back.

const FAKE_EMAIL = "titolare.prova@example.test";
const fakeSecret = () => `frase-di-prova-${randomUUID()}`;
const LEAK_IN_URL = /(email|password|pin|code|label|newPassword|currentPassword|repeat)=/i;

/** Pressing Enter may submit (if the button were enabled) or do nothing. Either way no value may reach a URL. */
async function pressEnterAndWatch(page: Page, secret: string, field: () => Promise<void>) {
  const requested: string[] = [];
  const documents: { url: string; status: number }[] = [];
  page.on("request", (request) => requested.push(request.url()));
  page.on("response", (response) => {
    if (response.request().isNavigationRequest()) {
      documents.push({ url: response.url(), status: response.status() });
    }
  });
  // A real submit navigates within a moment; give it that moment before looking (nothing to wait for otherwise).
  const navigated = page.waitForEvent("framenavigated", { timeout: 1_500 }).catch(() => null);
  await field();
  await navigated;
  for (const url of [page.url(), ...requested, ...documents.map((document) => document.url)]) {
    expect(url).not.toMatch(LEAK_IN_URL);
  }
  for (const document of documents) expect(document.status).toBeLessThan(500);
  expect(await page.content()).not.toContain(secret);
}

/** The POST a browser sends for a native submit of a form with `method="post"`, as the server receives it. */
async function nativePost(page: Page, path: string, fields: Record<string, string>) {
  const response = await page.request.post(path, { form: fields });
  await expectHarmless(response, Object.values(fields));
  return response;
}

async function expectHarmless(response: APIResponse, secrets: string[]) {
  expect(response.status(), `${response.url()} answered ${response.status()}`).toBeLessThan(500);
  expect(response.url()).not.toMatch(LEAK_IN_URL);
  const body = await response.text();
  for (const secret of secrets) expect(body).not.toContain(secret);
}

test.describe("public forms, page as the server sent it (JavaScript off)", () => {
  test.use({ javaScriptEnabled: false });

  test("/login: POST form, buttons disabled, Enter puts nothing in a URL", async ({ page }) => {
    await page.goto("/login");
    const main = page.locator("main");
    const email = main.getByLabel("Email", { exact: true });
    const password = main.getByLabel("Password", { exact: true });
    await expect(email).toBeVisible();
    await expect(password).toBeVisible();
    await expect(main.locator("form")).toHaveAttribute("method", "post");
    await expect(
      main.getByRole("button", { name: "Accedi con la password", exact: true }),
    ).toBeDisabled();
    await expect(main.getByRole("button", { name: "Inviami il link", exact: true })).toBeDisabled();

    const secret = fakeSecret();
    await pressEnterAndWatch(page, secret, async () => {
      await email.fill(FAKE_EMAIL);
      await password.fill(secret);
      await password.press("Enter");
    });
  });

  test("/dispositivo: POST form, button disabled, Enter puts nothing in a URL", async ({
    page,
  }) => {
    await page.goto("/dispositivo");
    const main = page.locator("main");
    // The label also holds the hint under the field, so the name is matched by its start.
    const code = main.getByRole("textbox", { name: /^Codice di abilitazione/ });
    await expect(code).toBeVisible();
    await expect(main.locator("form")).toHaveAttribute("method", "post");
    await expect(main.getByRole("button", { name: "Abilita", exact: true })).toBeDisabled();

    const secret = fakeSecret();
    await pressEnterAndWatch(page, secret, async () => {
      await code.fill(secret);
      await code.press("Enter");
    });
  });

  test("/pin: sends old bookmarks to /login, whose PIN pad is a POST form", async ({ page }) => {
    // The PIN pad is drawn by the browser after it asks the API who this phone is, so there is no PIN field in the
    // server HTML to type into. Its form is covered by the unit test and the guard; here the page itself.
    await page.goto("/pin");
    await expect(page).toHaveURL((url) => url.pathname === "/login" && url.search === "");
    await expect(page.locator("main").locator("form")).toHaveAttribute("method", "post");
  });

  test("a native POST to /login, /pin and /dispositivo is answered, and echoes nothing", async ({
    page,
  }) => {
    const secret = fakeSecret();
    await nativePost(page, "/login", { email: FAKE_EMAIL, password: secret });
    await nativePost(page, "/dispositivo", { code: secret });
    // /pin redirects (307, which keeps the method) to /login: the final page is the login page.
    const pin = await nativePost(page, "/pin", { pin: secret });
    expect(new URL(pin.url()).pathname).toBe("/login");
  });

  test("a native POST to the signed-in pages sends a signed-out visitor to the login page", async ({
    page,
  }) => {
    const secret = fakeSecret();
    for (const path of ["/password", "/personale", "/dispositivi"]) {
      const response = await nativePost(page, path, {
        newPassword: secret,
        currentPassword: secret,
        pin: secret,
        repeat: secret,
        label: secret,
      });
      expect(new URL(response.url()).pathname, path).toBe("/login");
    }
  });
});

test.describe("public forms, after React has hydrated them", () => {
  test("the buttons that were disabled in the server HTML become usable", async ({ page }) => {
    await page.goto("/login");
    const main = page.locator("main");
    await expect(
      main.getByRole("button", { name: "Accedi con la password", exact: true }),
    ).toBeEnabled();
    await expect(main.getByRole("button", { name: "Inviami il link", exact: true })).toBeEnabled();
    await page.goto("/dispositivo");
    await expect(main.getByRole("button", { name: "Abilita", exact: true })).toBeEnabled();
  });
});

test.describe("signed-in forms with a secret", () => {
  requireSupabaseStack();

  test("a native POST to /password, /personale and /dispositivi is answered, and echoes nothing", async ({
    page,
  }) => {
    await signInWithMagicLink(page, createOwner());
    const secret = fakeSecret();
    for (const path of ["/password", "/personale", "/dispositivi"]) {
      const response = await nativePost(page, path, {
        newPassword: secret,
        currentPassword: secret,
        pin: secret,
        repeat: secret,
        label: secret,
      });
      expect(new URL(response.url()).pathname, path).toBe(path);
    }
  });
});
