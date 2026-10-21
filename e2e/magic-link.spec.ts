import { execFileSync } from "node:child_process";
import { randomInt, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";
import { latestLinkFor } from "./helpers/mailbox";

// Needs the full local Supabase stack (Auth + Mailpit). CI starts it and sets these variables;
// a CI run without them is a configuration error, not a reason to skip.
const MAILPIT_URL = process.env.E2E_MAILPIT_URL;
if (process.env.CI && !MAILPIT_URL) throw new Error("E2E_MAILPIT_URL must be set in CI");
test.skip(!MAILPIT_URL, "needs the local Supabase stack (npx supabase start); runs in CI");

const fakeVat = () => `IT${String(randomInt(0, 1e11)).padStart(11, "0")}`;
const fakeEmail = (label: string) => `${label}+${randomUUID().slice(0, 8)}@example.test`;

async function signInWithMagicLink(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Inviami il link" }).click();
  await expect(page.getByRole("status")).toContainText("riceverai un'email");
  await page.goto(await latestLinkFor(MAILPIT_URL!, email));
  await page.waitForURL((url) => url.pathname === "/");
}

test("owner signs in with a magic link and /api/me says owner (acceptance tests 4, 8)", async ({
  page,
}) => {
  const email = fakeEmail("owner");
  execFileSync(
    "npx",
    [
      "tsx",
      "scripts/create-tenant.ts",
      "--name",
      "Osteria Demo",
      "--vat",
      fakeVat(),
      "--owner-email",
      email,
      "--owner-name",
      "Titolare Demo",
    ],
    { stdio: "pipe" },
  );

  await signInWithMagicLink(page, email);
  await expect(page.getByTestId("role")).toHaveText("Ruolo: Titolare");

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
