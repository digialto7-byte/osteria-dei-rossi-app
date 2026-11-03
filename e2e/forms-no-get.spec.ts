import { randomUUID } from "node:crypto";
import { expect, test, type APIResponse, type Page, type Request } from "@playwright/test";
import {
  createOwner,
  requireSupabaseStack,
  signInWithMagicLink,
  waitForHydration,
} from "./helpers/session";

// A tap on a sign-in form before React has hydrated it is a native form submit. A form with no method is a GET: the
// browser then writes the typed e-mail and password into the URL (history, server and proxy logs). Now every form
// is method="post" and the buttons that send a secret stay disabled until hydration. The inputs are not readonly (a
// password manager skips a readonly field): what is typed or autofilled early stays in the DOM and is what gets sent.
// The first specs run with JavaScript off, so the page stays exactly as the server sent it (the state of a phone
// before hydration).
//
// With the button disabled, Enter in a field submits nothing in a browser (a disabled default button blocks implicit
// submission). So the Enter tests prove no value reaches a URL, and the request tests send the POST a browser would
// have sent, to show what the server does with it: it must not answer 500 and must not echo the values back (the
// response body is checked there; a page's HTML never holds what was typed, so it proves nothing).

const FAKE_EMAIL = "titolare.prova@example.test";
const fakeEmail = () => `titolare.${randomUUID()}@example.test`;
const fakeSecret = () => `frase-di-prova-${randomUUID()}`;
const LEAK_IN_URL = /(email|password|pin|code|label|newPassword|currentPassword|repeat)=/i;

/**
 * Pressing Enter in a form whose send button is disabled must do nothing: no value reaches a URL, and no request at
 * all goes out (no document request, no GET or POST to the page itself) because implicit submission is blocked.
 */
async function pressEnterAndWatch(page: Page, field: () => Promise<void>) {
  const requests: Request[] = [];
  const documents: { url: string; status: number }[] = [];
  const pagePath = new URL(page.url()).pathname;
  page.on("request", (request) => requests.push(request));
  page.on("response", (response) => {
    if (response.request().isNavigationRequest()) {
      documents.push({ url: response.url(), status: response.status() });
    }
  });
  // A real submit navigates within a moment; give it that moment before looking (nothing to wait for otherwise).
  const navigated = page.waitForEvent("framenavigated", { timeout: 1_500 }).catch(() => null);
  await field();
  await navigated;
  const requested = requests.map((request) => request.url());
  for (const url of [page.url(), ...requested, ...documents.map((document) => document.url)]) {
    expect(url).not.toMatch(LEAK_IN_URL);
  }
  // Implicit submission did nothing: nothing was sent, and the page did not move.
  const sent = requests.map((request) => `${request.method()} ${request.url()}`);
  expect(sent, "requests after Enter").toEqual([]);
  expect(requests.filter((request) => request.isNavigationRequest())).toEqual([]);
  expect(requests.filter((request) => new URL(request.url()).pathname === pagePath)).toEqual([]);
  expect(new URL(page.url()).pathname).toBe(pagePath);
  for (const document of documents) expect(document.status).toBeLessThan(500);
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

    // The inputs are editable with JavaScript off; Enter must still put nothing in a URL.
    await pressEnterAndWatch(page, async () => {
      await email.fill(FAKE_EMAIL);
      await password.fill(fakeSecret());
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

    await pressEnterAndWatch(page, async () => {
      await code.fill(fakeSecret());
      await code.press("Enter");
    });
  });

  test("/pin: sends old bookmarks to /login, which shows the password form as a POST form", async ({
    page,
  }) => {
    // With no device cookie /login shows the password form. The PIN pad is drawn by the browser after it asks the API
    // who this phone is, so there is no PIN field in the server HTML. Its form is covered by the unit test and the
    // guard; here the page a bookmark lands on.
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

test.describe("values typed before hydration", () => {
  test("/login: an e-mail and password typed before React took over are the ones sent", async ({
    page,
  }) => {
    // Hold back the JavaScript so the form is certainly still the server's HTML while the fields are filled.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/_next/static/chunks/**", async (route) => {
      await gate;
      await route.continue().catch(() => undefined);
    });
    await page.goto("/login", { waitUntil: "domcontentloaded" });
    const main = page.locator("main");
    const email = fakeEmail();
    const password = fakeSecret();
    await main.getByLabel("Email", { exact: true }).fill(email);
    await main.getByLabel("Password", { exact: true }).fill(password);
    await expect(main.locator('form[data-hydrated="true"]')).toHaveCount(0);
    await expect(
      main.getByRole("button", { name: "Accedi con la password", exact: true }),
    ).toBeDisabled();

    release();
    await waitForHydration(page);
    const submit = main.getByRole("button", { name: "Accedi con la password", exact: true });
    await expect(submit).toBeEnabled();

    const posted = page.waitForRequest(
      (request) => request.url().endsWith("/api/auth/password") && request.method() === "POST",
    );
    await submit.click();
    const body = (await posted).postDataJSON() as { email: string; password: string };
    expect(body.email).toBe(email);
    expect(body.password).toBe(password);
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
