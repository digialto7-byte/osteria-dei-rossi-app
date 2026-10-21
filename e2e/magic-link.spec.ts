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

  const sessionCookies = (await page.context().cookies()).filter((c) => c.name.startsWith("sb-"));
  expect(sessionCookies.length).toBeGreaterThan(0);
  for (const cookie of sessionCookies) {
    expect(cookie).toMatchObject({ httpOnly: true, secure: true, sameSite: "Lax" });
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
