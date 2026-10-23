import { execFileSync } from "node:child_process";
import { randomInt, randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { admin } from "./seed-invoice";
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

/**
 * Adds a chef, a waiter or an admin to an existing tenant (fake data, through the local stack's secret key, as
 * the integration helpers do) and returns the email to sign in with. The tenant id comes from the
 * signed-in owner (`tenantIdOf`). Never used to read or write alerts: those go through the API.
 */
export async function createStaff(
  tenantId: string,
  role: "chef" | "waiter" | "admin",
): Promise<string> {
  const db = admin();
  const email = fakeEmail(role);
  const created = await db.auth.admin.createUser({ email, email_confirm: true });
  const authId = created.data.user?.id;
  if (created.error || !authId) throw new Error(`Fixture failed: ${role} user`);
  const member = await db
    .from("app_user")
    .insert({ tenant_id: tenantId, auth_id: authId, role, display_name: `${role} Demo` });
  if (member.error) throw new Error(`Fixture failed: ${role} membership: ${member.error.message}`);
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
  const { overflow, culprits } = await page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    // On a failure, name the elements that stick out, so a CI log is enough to find the cause.
    const elements = [...document.querySelectorAll("body *")];
    const culprits = elements
      .filter((element) => element.getBoundingClientRect().right > width)
      .map((element) => {
        const right = element.getBoundingClientRect().right.toFixed(2);
        return `element right=${right} ${element.outerHTML.slice(0, 200)}`;
      });
    // Text can spill out of a box that itself fits; a Range measures the text.
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const range = document.createRange();
      range.selectNodeContents(node);
      const right = range.getBoundingClientRect().right;
      if (right > width) {
        const parent = node.parentElement?.outerHTML.slice(0, 160) ?? "";
        culprits.push(`text right=${right.toFixed(2)} "${node.textContent}" in ${parent}`);
      }
    }
    for (const element of elements) {
      if (element.scrollWidth > element.clientWidth && element.clientWidth > 0) {
        const sizes = `${element.scrollWidth}>${element.clientWidth}`;
        culprits.push(`content wider than box ${sizes} ${element.outerHTML.slice(0, 160)}`);
      }
    }
    return {
      overflow: document.documentElement.scrollWidth - width,
      culprits: culprits.slice(0, 15),
    };
  });
  expect(overflow, `${page.url()}\n${culprits.join("\n")}`).toBeLessThanOrEqual(0);
}
