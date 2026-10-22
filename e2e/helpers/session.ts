import { execFileSync } from "node:child_process";
import { randomInt, randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { latestLinkFor } from "./mailbox";
import { MIN_MEASURED_TAP_PX } from "./tap";

// Specs that sign in need the full local Supabase stack (Auth + Mailpit). CI starts it and sets
// E2E_MAILPIT_URL; a CI run without it is a configuration error, not a reason to skip.
export const MAILPIT_URL = process.env.E2E_MAILPIT_URL;

export function requireSupabaseStack(): void {
  if (process.env.CI && !MAILPIT_URL) throw new Error("E2E_MAILPIT_URL must be set in CI");
  test.skip(!MAILPIT_URL, "needs the local Supabase stack (npx supabase start); runs in CI");
}

/** A random tenant VAT number (the tenant check is format-only; see M1 plan Q3). */
export const fakeVat = () => `IT${String(randomInt(0, 1e11)).padStart(11, "0")}`;
export const fakeEmail = (label: string) => `${label}+${randomUUID().slice(0, 8)}@example.test`;

/** Creates a fresh tenant and owner with fake data through the admin script; returns the email. */
export function createOwner(): string {
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
  return email;
}

export async function signInWithMagicLink(page: Page, email: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Inviami il link" }).click();
  await expect(page.getByRole("status")).toContainText("riceverai un'email");
  await page.goto(await latestLinkFor(MAILPIT_URL!, email));
  await page.waitForURL((url) => url.pathname === "/");
}

/** Phone-first checks: every control is at least 44 px tall and nothing scrolls sideways. */
export async function expectPhoneFriendly(page: Page): Promise<void> {
  const controls = page.locator("main button, main input:not([type=checkbox]), main select");
  for (const control of await controls.all()) {
    if (!(await control.isVisible())) continue;
    const box = await control.boundingBox();
    expect(box?.height ?? 0, await control.evaluate((el) => el.outerHTML)).toBeGreaterThanOrEqual(
      MIN_MEASURED_TAP_PX,
    );
  }
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}
