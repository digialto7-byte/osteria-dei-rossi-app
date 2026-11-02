import { expect, test } from "@playwright/test";
import {
  createOwner,
  requireSupabaseStack,
  setFixturePassword,
  signInWithPassword,
} from "./helpers/session";

requireSupabaseStack();

// M25a (plan T4): a sign-in must outlive the browser. The session cookies are HttpOnly, set by our own server and persistent
// (an expiry far beyond the 30 days the app enforces itself), and a "relaunched" browser that kept its cookies is still
// signed in. Runs on Chromium (phone) and on WebKit (phone-webkit); a real installed iPhone and Android app cannot be
// automated here, so the founder's check on two phones is manual step M-3. One password sign-in per project.

const THIRTY_DAYS_S = 30 * 24 * 60 * 60;

test("the session cookies are persistent and a relaunched browser is still signed in", async ({
  page,
  browser,
}) => {
  const email = createOwner();
  const password = await setFixturePassword(email);
  await signInWithPassword(page, email, password);
  await expect(page.getByTestId("role")).toHaveText("Ruolo: Titolare");

  // Secure everywhere except plain http to a loopback host (the CI build), where WebKit would drop Secure cookies.
  const origin = new URL(page.url());
  const plainHttpLoopback =
    origin.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname);
  const sessionCookies = (await page.context().cookies()).filter((c) => c.name.startsWith("sb-"));
  expect(sessionCookies.length).toBeGreaterThan(0);
  const nowS = Date.now() / 1000;
  for (const cookie of sessionCookies) {
    expect(cookie, cookie.name).toMatchObject({
      httpOnly: true,
      secure: !plainHttpLoopback,
      sameSite: "Lax",
    });
    // A session cookie reports expires = -1; a persistent one reports an epoch second.
    expect(cookie.expires, `${cookie.name} must be persistent`).toBeGreaterThan(
      nowS + THIRTY_DAYS_S,
    );
  }

  // A relaunch: a new context starting from what the first one stored on disk.
  const stored = await page.context().storageState();
  const relaunched = await browser.newContext({
    baseURL: test.info().project.use.baseURL,
    storageState: stored,
  });
  try {
    const again = await relaunched.newPage();
    await again.goto("/");
    await expect(again).toHaveURL((url) => url.pathname === "/");
    await expect(again.getByTestId("role")).toHaveText("Ruolo: Titolare");
    expect((await again.request.get("/api/me")).status()).toBe(200);
  } finally {
    await relaunched.close();
  }
});
