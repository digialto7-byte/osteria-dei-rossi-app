import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { addDays } from "@/lib/time/venue-date";
import {
  cancelLinkFrom,
  drainMailJob,
  waitForMail,
} from "../tests/integration/helpers/reservation-mail";
import { collectCspViolations } from "./helpers/csp";
import { businessDateOf } from "./helpers/services";
import {
  createOwner,
  expectPhoneFriendly,
  MAILPIT_URL,
  requireSupabaseStack,
  signInWithMagicLink,
} from "./helpers/session";

requireSupabaseStack();

// Reservations, the public side, on a phone (360 x 740), lean (plan B13). The owner switches the page on through the settings API (the staff screens are covered by
// reservations-staff.spec.ts); then a signed-out customer, in a second browser context, picks a date, a party and a time, fills in the form, ticks the privacy box, waits
// the 3 seconds the form token needs and sends the request. The mail cron route is run at once (with the CI CRON_SECRET) instead of waiting for pg_cron, Mailpit
// holds the e-mail, and its cancel link cancels the booking. The page runs under the nonce CSP (ADR-028): the violation collector must report nothing. Fake data
// only ("Cliente Demo", example.com).
const CRON_SECRET = process.env.CRON_SECRET;
if (process.env.CI && !CRON_SECRET) throw new Error("CRON_SECRET must be set in CI");

const FORM_MIN_WAIT_MS = 3200;

// Every wait in this spec is bounded well under the 240 s test timeout. Playwright's own defaults are not: an action (click, fill, check, goto) has NO timeout
// of its own and waits until the test ends, so one control that never appears or never enables looks like a 4-minute hang with an empty log (CI 42816189119).
const ACTION_TIMEOUT_MS = 15_000;
const NAVIGATION_TIMEOUT_MS = 30_000;
const RESPONSE_TIMEOUT_MS = 15_000;
const CRON_TIMEOUT_MS = 25_000;
const DRAIN_BUDGET_MS = 90_000;
const MAIL_TIMEOUT_MS = 20_000;

/** One line per phase: the name and the milliseconds, nothing else (no address, name or token). */
async function phase<T>(name: string, body: () => Promise<T>): Promise<T> {
  return test.step(name, async () => {
    const started = Date.now();
    try {
      return await body();
    } finally {
      console.log(`[reservations-public] ${name}: ${Date.now() - started} ms`);
    }
  });
}

test.describe("the public booking page on a phone (360 px)", () => {
  test.setTimeout(240_000);
  test.use({ actionTimeout: ACTION_TIMEOUT_MS, navigationTimeout: NAVIGATION_TIMEOUT_MS });
  test.skip(!CRON_SECRET, "CRON_SECRET is not set: the mail route cannot be run here");

  test("a customer requests a table, gets the e-mail and cancels with its link", async ({
    page,
    browser,
    baseURL,
  }, testInfo) => {
    // --- The owner switches the page on --------------------------------------------------------------------------------
    const slug = `osteria-demo-${randomUUID().slice(0, 8)}`;
    const date = await phase("owner: sign in and switch the page on", async () => {
      await signInWithMagicLink(page, createOwner());
      const saved = await page.request.patch("/api/settings/reservations", {
        timeout: CRON_TIMEOUT_MS,
        data: {
          publicSlug: slug,
          privacyControllerName: "Osteria Demo S.r.l. (demo)",
          privacyContactEmail: "privacy@example.com",
          services: [
            {
              key: "cena",
              online: true,
              firstSeating: "19:00",
              lastSeating: "21:30",
              coversPerSlot: null,
              reservationsPerSlot: null,
              coversPerService: null,
            },
          ],
        },
      });
      expect(saved.status(), await saved.text()).toBe(200);
      const on = await page.request.patch("/api/settings/reservations", {
        timeout: CRON_TIMEOUT_MS,
        data: { enabled: true },
      });
      expect(on.status(), await on.text()).toBe(200);
      // Three days out: past the lead time and inside the horizon, whatever time the run starts.
      return addDays(await businessDateOf(page), 3);
    });

    // --- A customer, signed out, in a second context -------------------------------------------------------------------
    const context = await browser.newContext({ baseURL, viewport: { width: 360, height: 740 } });
    context.setDefaultTimeout(ACTION_TIMEOUT_MS);
    context.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT_MS);
    const csp = await collectCspViolations(context);
    const guest = await context.newPage();
    const email = `cliente.demo.${randomUUID().slice(0, 8)}@example.com`;
    let lastPhase = "none";
    const guestPhase = <T>(name: string, body: () => Promise<T>) => {
      lastPhase = name;
      return phase(name, body);
    };
    try {
      await guestPhase("guest: open the page", async () => {
        await guest.goto(`/prenota/${slug}`);
        // No redirect to /login: the page is public.
        expect(new URL(guest.url()).pathname).toBe(`/prenota/${slug}`);
        await expect(
          guest.getByRole("heading", { name: "Osteria Demo", exact: false }),
        ).toBeVisible();
        await expectPhoneFriendly(guest);
      });

      await guestPhase("guest: fill the form", async () => {
        await guest.getByLabel("Data", { exact: true }).fill(date);
        // A <select> inside its <label> takes the chosen option into its name ("Persone 2"), so match the start, as the other specs do.
        await guest.getByRole("combobox", { name: /^Persone\b/ }).selectOption("4");
        await guest.getByRole("button", { name: "20:00", exact: true }).click();
        await guest.getByLabel("Nome", { exact: true }).fill("Cliente Demo");
        await guest.getByLabel("Telefono", { exact: true }).fill("+39 000 0000001");
        await guest.getByLabel("E-mail", { exact: true }).fill(email);
        // The customer never sees a table.
        await expect(guest.locator("main")).not.toContainText(/tavol/i);
        await expect(
          guest.getByRole("button", { name: "Invia richiesta", exact: true }),
        ).toBeDisabled();
        await guest.getByLabel("Ho letto l'informativa privacy", { exact: true }).check();
        await expectPhoneFriendly(guest);
      });

      await guestPhase("guest: send the request", async () => {
        // The form token opens 3 seconds after the page was read.
        await guest.waitForTimeout(FORM_MIN_WAIT_MS);
        const [sent] = await Promise.all([
          guest.waitForResponse(
            (r) =>
              new URL(r.url()).pathname === `/api/public/reservations/${slug}/requests` &&
              r.request().method() === "POST",
            { timeout: RESPONSE_TIMEOUT_MS },
          ),
          guest.getByRole("button", { name: "Invia richiesta", exact: true }).click(),
        ]);
        expect(sent.status()).toBe(202);
        await expect(guest.getByRole("status")).toHaveText(
          "Richiesta inviata: ti scriveremo via e-mail appena confermata.",
        );
        await expectPhoneFriendly(guest);
      });

      // --- The mail job runs, Mailpit holds the e-mail, its link cancels -------------------------------------------------
      // One run claims only the oldest 10 due rows and other suites may have left more queued: run it until it handles none (at most 10 rounds, within a time budget).
      await guestPhase("mail job: drain", async () => {
        const drained = await drainMailJob(
          async () => {
            const job = await page.request.post("/api/cron/reservation-mail", {
              headers: { authorization: `Bearer ${CRON_SECRET}` },
              data: {},
              timeout: CRON_TIMEOUT_MS,
            });
            expect(job.status(), await job.text()).toBe(200);
            return (await job.json()) as { handled: number; sent: number; failed: number };
          },
          undefined,
          { budgetMs: DRAIN_BUDGET_MS },
        );
        console.log(
          `[reservations-public] mail drain: rounds=${drained.rounds} handled=${drained.handled} sent=${drained.sent} failed=${drained.failed}`,
        );
      });
      const link = await guestPhase("mail: wait for the e-mail", async () => {
        const mail = await waitForMail(MAILPIT_URL!, email, {
          subject: /ricevuta/i,
          timeoutMs: MAIL_TIMEOUT_MS,
        });
        const found = cancelLinkFrom(mail.text);
        expect(found, "the e-mail carries a cancel link").not.toBeNull();
        return found!;
      });

      await guestPhase("guest: open the cancel link", async () => {
        await guest.goto(link.url);
        await expect(
          guest.getByRole("heading", { name: "Annulla la prenotazione", exact: true }),
        ).toBeVisible();
        await expect(guest.locator("main")).toContainText("4 persone");
        await expect(guest.locator("main")).not.toContainText(/tavol/i);
        await expectPhoneFriendly(guest);
        // Opening the link only shows the booking.
        await expect(guest.getByText("In attesa di conferma", { exact: true })).toBeVisible();
      });
      await guestPhase("guest: cancel", async () => {
        const [cancelled] = await Promise.all([
          guest.waitForResponse(
            (r) =>
              new URL(r.url()).pathname === `/api/public/reservations/${slug}/cancel` &&
              r.request().method() === "POST",
            { timeout: RESPONSE_TIMEOUT_MS },
          ),
          guest.getByRole("button", { name: "Annulla prenotazione", exact: true }).click(),
        ]);
        expect(cancelled.status()).toBe(200);
        await expect(guest.getByRole("status")).toHaveText("Prenotazione annullata.");
      });

      // The page and the cancel page ran under the nonce policy without one violation.
      expect(csp.violations).toEqual([]);
    } catch (error) {
      // Where the GUEST was (the report's own snapshot is the owner's page): the phase, the path and the page's structure. The structure holds only the fake form
      // data typed above, never a token (the cancel link's token is in the query, which is not logged).
      console.log(
        `[reservations-public] failed in "${lastPhase}" at ${new URL(guest.url(), "http://x").pathname}`,
      );
      const snapshot = await guest
        .locator("body")
        .ariaSnapshot({ timeout: 3_000 })
        .catch(() => "no snapshot");
      await testInfo.attach("guest-aria-snapshot", { body: snapshot, contentType: "text/plain" });
      throw error;
    } finally {
      await context.close();
    }
  });

  test("the English page is reached with ?lang=en and an unknown address is a plain not-available text", async ({
    page,
  }) => {
    await page.goto("/prenota/osteria-demo-nessuna?lang=en");
    expect(new URL(page.url()).pathname).toBe("/prenota/osteria-demo-nessuna");
    await expect(
      page.getByText("This booking page is not available.", { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Italiano", exact: true })).toBeVisible();
  });
});
