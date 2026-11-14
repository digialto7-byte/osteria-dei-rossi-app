import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import {
  createOwner,
  fakeEmail,
  requireSupabaseStack,
  signInWithMagicLink,
} from "./helpers/session";

requireSupabaseStack();

test("owner signs in with a magic link and /api/me says owner (acceptance tests 4, 8)", async ({
  page,
}) => {
  const email = createOwner();

  await signInWithMagicLink(page, email);
  await expect(page.getByTestId("role")).toHaveText("Ruolo: Titolare");

  // Secure everywhere except plain http to a loopback host (the CI build on http://localhost:3000),
  // where WebKit would drop Secure cookies. Against any https or non-loopback URL this asserts Secure.
  const origin = new URL(page.url());
  const plainHttpLoopback =
    origin.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname);
  const sessionCookies = (await page.context().cookies()).filter((c) => c.name.startsWith("sb-"));
  expect(sessionCookies.length).toBeGreaterThan(0);
  for (const cookie of sessionCookies) {
    expect(cookie).toMatchObject({ httpOnly: true, secure: !plainHttpLoopback, sameSite: "Lax" });
  }

  const me = await page.request.get("/api/me");
  expect(me.status()).toBe(200);
  expect((await me.json()).user.role).toBe("owner");

  await page.getByRole("button", { name: "Esci" }).click();
  await page.waitForURL((url) => url.pathname === "/login");
  expect((await page.request.get("/api/me")).status()).toBe(401);
});

test("an auth user without app_user gets no tenant claim: /api/me is 403 (acceptance test 4)", async ({
  page,
}) => {
  const email = fakeEmail("stranger");
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    {
      auth: { persistSession: false },
    },
  );
  const { error } = await admin.auth.admin.createUser({ email, email_confirm: true });
  expect(error).toBeNull();

  await signInWithMagicLink(page, email);
  await expect(page.getByRole("alert").filter({ hasText: "non è abilitato" })).toBeVisible();
  const me = await page.request.get("/api/me");
  expect(me.status()).toBe(403);
  expect((await me.json()).error.code).toBe("no_tenant");
});

// Regression (main CI 43646655732): signInWithMagicLink must return only once the landing page's own requests have settled, so a
// spec that starts counting afterwards (reports.spec.ts, "posts exactly one open") sees none of them. Oggi POSTs its one open only
// after its GET /api/dashboard answers; holding that first GET for up to 2 s makes the race certain: a helper that returned at the URL
// change ("Non ora" on /password is a client navigation to /) would let the POST arrive inside the watch window below.
// The hold must never span the helper's final document load of / (main CI 43652328075, a7e700e6: holding every GET for 2 s, the
// helper's page.goto(landing, networkidle) timed out at 30 s). Our hypothesis, not proven from Playwright's sources or reproduced
// locally, is that a held request of the document being replaced, continued after the new one commits, keeps networkidle from
// settling. So: if a load of / has already started when Oggi's first GET arrives, it is not held; otherwise it is held until such a
// load starts (then aborted: its document is going away) or for 2 s (then continued, which is what the old helper meets).
test("signInWithMagicLink returns after the landing page's own requests, so none of them reach a later counter", async ({
  page,
}) => {
  const email = createOwner();
  // Armed before the sign-in: the main frame's document loads of the landing page. On the owner's link path only the helper's
  // final page.goto("/") is one (the link goes through /auth/callback to /password, and "Non ora" is a client navigation).
  let landingLoadStarted = false;
  const onLandingLoad: (() => void)[] = [];
  page.on("request", (request) => {
    if (!request.isNavigationRequest() || request.frame() !== page.mainFrame()) return;
    if (new URL(request.url()).pathname !== "/") return;
    landingLoadStarted = true;
    onLandingLoad.splice(0).forEach((notify) => notify());
  });
  let firstGetSeen = false;
  await page.route("**/api/dashboard", async (route) => {
    if (route.request().method() !== "GET" || firstGetSeen) return route.continue();
    firstGetSeen = true;
    if (landingLoadStarted) return route.continue();
    const replaced = await new Promise<boolean>((release) => {
      const timer = setTimeout(() => release(false), 2_000);
      onLandingLoad.push(() => {
        clearTimeout(timer);
        release(true);
      });
    });
    await (replaced ? route.abort("aborted") : route.continue());
  });
  await signInWithMagicLink(page, email);
  expect(
    firstGetSeen,
    "the landing page's GET /api/dashboard went through the route: the hold could apply",
  ).toBe(true);

  const late: string[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith("/api/dashboard")) late.push(`${request.method()} ${path}`);
  });
  // Well past the held GET (2 s) plus a slow server, so a POST the helper left behind is recorded; Oggi refreshes only on focus or visibility.
  await page.waitForTimeout(5_000);
  expect(late).toEqual([]);
});
