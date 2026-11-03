import { execFileSync } from "node:child_process";
import { randomInt, randomUUID } from "node:crypto";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { admin } from "./seed-invoice";
import { latestLinkFor } from "./mailbox";
import { MIN_MEASURED_TAP_PX, smallTapTargets } from "./tap";

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

/** The tenant id `scripts/create-tenant.ts` printed for each owner made here (setFixturePassword needs it). */
const tenantOfOwner = new Map<string, string>();

/** Creates a fresh tenant and owner with fake data through the admin script; returns the email. */
export function createOwner(): string {
  const email = fakeEmail("owner");
  const printed = execFileSync(
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
  tenantOfOwner.set(email, printed.toString().trim());
  return email;
}

/**
 * Gives a `createOwner()` owner a password and returns it (M25a). Only the two M25a specs sign in with a password: every
 * other spec keeps the e-mail link, so the 135 or so sign-ins do not draw on Auth's per-IP sign-in bucket that the PIN
 * logins share (plan §3.1.11). Local stack only, through its secret key like `createStaff`. The password is made at run
 * time and never stored.
 */
export async function setFixturePassword(email: string): Promise<string> {
  const tenantId = tenantOfOwner.get(email);
  if (!tenantId) throw new Error("setFixturePassword needs an owner made by createOwner()");
  const db = admin();
  const owner = await db
    .from("app_user")
    .select("auth_id")
    .eq("tenant_id", tenantId)
    .eq("role", "owner")
    .single();
  if (owner.error || !owner.data) throw new Error("Fixture failed: owner membership");
  const password = `frase di prova ${randomUUID()}`;
  const updated = await db.auth.admin.updateUserById(owner.data.auth_id as string, { password });
  if (updated.error) throw new Error("Fixture failed: owner password");
  return password;
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

/**
 * Waits until React has taken over the form on the page: a form that uses `useHydrated` carries
 * `data-hydrated="true"` from then on, and its send buttons are enabled. Text typed earlier would survive anyway
 * (the fields are uncontrolled), but the click would reach no handler. Pass `form` when a page holds several.
 */
export async function waitForHydration(page: Page, form?: Locator): Promise<void> {
  const hydrated = page.locator("main").locator('form[data-hydrated="true"]');
  if (form) await expect(form).toHaveAttribute("data-hydrated", "true");
  else await expect(hydrated).not.toHaveCount(0);
}

/** Twice the auth `max_frequency` of 1 s, so second-granularity rounding on the server cannot refuse the request. */
const SAME_ADDRESS_GAP_MS = 2_000;
const lastLinkRequestAt = new Map<string, number>();

/**
 * Signs in through the magic link and waits for the exact page the role lands on: Oggi ("/", the default) for
 * the owner, admin and chef, "/tavoli" for the waiter. An owner wrongly sent to the tables fails here, and
 * callers never race the waiter's redirect from "/".
 */
export async function signInWithMagicLink(
  page: Page,
  email: string,
  landing: "/" | "/tavoli" = "/",
): Promise<void> {
  await page.goto("/login");
  await waitForHydration(page);
  // Auth sends no second link to the same address within `max_frequency` (supabase/config.toml, 1 s). The page
  // still shows the "sent" status (ADR-029, Timing), so the mailbox would hold only the previous, already-used link.
  // A spec that signs the same owner in for several short tests in a row can ask again within that second, so wait
  // out the interval for this address first.
  const last = lastLinkRequestAt.get(email);
  if (last !== undefined) {
    const wait = last + SAME_ADDRESS_GAP_MS - Date.now();
    if (wait > 0) await page.waitForTimeout(wait);
  }
  // The login form is a client component. On WebKit the first fill and click can land before React hydrates: the
  // address typed then never reaches React's state (or the click reaches no handler), and no request goes to Auth (CI,
  // 2026-11-02, #50: no /otp call, no status). Type and ask again until the page answers with the "sent" status. Each
  // real click is stamped for the same-address gap above, so the next sign-in waits from the request Auth actually saw.
  const main = page.locator("main");
  const sent = main.getByRole("status");
  await expect(async () => {
    // A slow answer to the previous try may have arrived since: then the button is gone and the status is there.
    if ((await sent.count()) === 0) {
      await main.getByLabel("Email", { exact: true }).fill(email, { timeout: 2_000 });
      lastLinkRequestAt.set(email, Date.now());
      await main
        .getByRole("button", { name: "Inviami il link", exact: true })
        .click({ timeout: 2_000 });
    }
    await expect(sent).toContainText("riceverai un'email", { timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
  await page.goto(await latestLinkFor(MAILPIT_URL!, email));
  await page.waitForURL((url) => url.pathname === landing);
}

/** Signs in on /login with e-mail and password (M25a) and waits for the page the role lands on. */
export async function signInWithPassword(
  page: Page,
  email: string,
  password: string,
  landing: "/" | "/tavoli" = "/",
): Promise<void> {
  await page.goto("/login");
  const main = page.locator("main");
  const submit = main.getByRole("button", { name: "Accedi con la password", exact: true });
  await waitForHydration(page);
  await expect(submit).toBeEnabled();
  await main.getByLabel("Email", { exact: true }).fill(email);
  await main.getByLabel("Password", { exact: true }).fill(password);
  await submit.click();
  await page.waitForURL((url) => url.pathname === landing);
}

/**
 * Phone-first checks: every control is at least 44 px tall and nothing scrolls sideways. The shell's
 * links (tab bar, section row) count as controls; the sidebar is `display: none` on a phone and skipped.
 */
export async function expectPhoneFriendly(page: Page): Promise<void> {
  // Measured in one pass inside the page: the shell re-renders when the role arrives, so measuring
  // locators one by one (nth-based) could pair one element's visibility with another element's box.
  const tooSmall = await page.evaluate(smallTapTargets, MIN_MEASURED_TAP_PX);
  expect(tooSmall).toEqual([]);
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
