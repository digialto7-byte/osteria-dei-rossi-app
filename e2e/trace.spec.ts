import { expect, test, type Page } from "@playwright/test";
import { businessDateOf } from "./helpers/business-date";
import { main, newContext } from "./helpers/order-ui";
import { tenantIdOf } from "./helpers/seed-invoice";
import { createWaiter, WAITER_A, WAITER_B } from "./helpers/seed-menu-tables";
import {
  createOwner,
  createStaff,
  expectPhoneFriendly,
  requireSupabaseStack,
  signInWithMagicLink,
} from "./helpers/session";
import {
  seedTraceE2e,
  seedUncodedInvoice,
  sellOne,
  TRACE_E2E,
  type TraceE2eSeed,
} from "./helpers/trace";

requireSupabaseStack();

// P2-2 on a phone (360 x 740), Chromium only (`phone`): Tracciabilità from a lot code to the batch and to a served plate, the chef's reduced view, the
// waiter's refusal, and the lot nudge on the invoice review. The tenant is seeded in a beforeAll through the real API (an approved invoice with one coded
// and one uncoded stock line, a batch from the coded lot, a plate sold once by a waiter). Every seeded date comes from the business date (02:00 cut-off), and
// the last test reads it again: a run that crossed the cut-off fails there with a plain message. Rows are found by their words and links, every locator is
// scoped to `main`, and no assertion rests on a time of day or on a sub-pixel value. The one place that spends a TOTP code (none here) would need
// `test.setTimeout(60_000)`; the whole file has a longer timeout anyway. Fake data only.
//   AT-P1 the lot lists its batch and "1 piatto"   AT-P5 "Lotto mancante" and the pre-approval count, approval not blocked   AT-P7 (chef, waiter)

test.describe.configure({ mode: "serial" });
test.setTimeout(300_000);

interface Fixture {
  email: string;
  chefEmail: string;
  waiterEmail: string;
  tenantId: string;
  seed: TraceE2eSeed;
  reviewInvoiceId: string;
}

let fixture: Fixture | null = null;

function seeded(): Fixture {
  if (!fixture) throw new Error("The beforeAll seeding did not run");
  return fixture;
}

// Serial mode re-runs this in a fresh worker after a failure, which seeds a new tenant: no test depends on another's leftovers except the last one
// (the invoice the nudge test approves is its own, and no test before it counts the lots).
test.beforeAll(async ({ browser }, testInfo) => {
  const owner = await newContext(browser, testInfo.project.use);
  const waiter = await newContext(browser, testInfo.project.use);
  try {
    const email = createOwner();
    await signInWithMagicLink(owner.page, email, "/");
    const tenantId = await tenantIdOf(owner.page);
    const waiterEmail = await createWaiter(tenantId, WAITER_A);
    await signInWithMagicLink(waiter.page, waiterEmail, "/tavoli");
    const seed = await seedTraceE2e(owner.page, tenantId, 72);
    await sellOne(waiter.page, seed.tableIds[0]!, seed.itemId);
    fixture = {
      email,
      chefEmail: await createStaff(tenantId, "chef"),
      waiterEmail: await createWaiter(tenantId, WAITER_B),
      tenantId,
      seed,
      reviewInvoiceId: await seedUncodedInvoice(tenantId, seed),
    };
  } finally {
    await waiter.context.close();
    await owner.context.close();
  }
});

const link = (page: Page, name: RegExp | string) => main(page).getByRole("link", { name });

test.describe("the owner", () => {
  test("follows a lot code to the lot, the batch and a served plate (AT-P1)", async ({ page }) => {
    const { email, seed } = seeded();
    await signInWithMagicLink(page, email);
    await page.goto("/tracciabilita");
    await expect(
      main(page).getByRole("heading", { name: "Tracciabilità", exact: true }),
    ).toBeVisible();
    // The capture card has loaded, so the page is hydrated. It shows the API's own count; read here, so the test does not depend on whether the
    // "receiving" test (which approves two more deliveries, with no lot) ran before it.
    const capture = (await (await page.request.get("/api/trace/capture")).json()) as {
      withLotCode: number;
      lots: number;
    };
    expect(capture.withLotCode, "the seeded coded delivery").toBeGreaterThanOrEqual(1);
    await expect(main(page)).toContainText(
      `Ultimi 30 giorni: ${capture.withLotCode} su ${capture.lots} consegne con il lotto.`,
    );

    // A prefix, in lower case: the search is by the start of the code and ignores the case.
    await main(page)
      .getByLabel(/^Codice lotto/)
      .fill("l-demo");
    await main(page).getByRole("button", { name: "Cerca", exact: true }).click();
    const row = link(page, new RegExp(TRACE_E2E.lotCode));
    await expect(row).toBeVisible();
    await expect(row).toContainText(TRACE_E2E.coded);
    await expectPhoneFriendly(page);

    await row.click();
    await page.waitForURL((url) => url.pathname === `/tracciabilita/lotto/${seed.lotId}`);
    await expect(
      main(page).getByRole("heading", { name: TRACE_E2E.coded, exact: true }),
    ).toBeVisible();
    await expect(main(page)).toContainText("Fornitore Demo Srl");
    await expect(main(page)).toContainText("Articolo");
    await expect(link(page, /^Fattura n\. .+ del /)).toBeVisible();
    await expect(main(page)).toContainText("Lotti di produzione (1)");
    await expect(main(page)).toContainText(/Lasagne Demo\s+·\s+1 piatto\s+\(1 porz\.\)/);
    await expect(main(page)).not.toContainText("Alcuni dati mancano");
    await expect(main(page)).not.toContainText("Annullati dopo l'invio");
    await expectPhoneFriendly(page);

    await link(page, new RegExp(`^${TRACE_E2E.batchRecipe} · `)).click();
    await page.waitForURL((url) => url.pathname === `/tracciabilita/produzione/${seed.batchId}`);
    await expect(
      main(page).getByRole("heading", { name: TRACE_E2E.batchRecipe, exact: true }),
    ).toBeVisible();
    await expect(main(page)).toContainText("Da dove viene");
    await expect(main(page)).toContainText(`lotto ${TRACE_E2E.lotCode}`);
    await expect(link(page, /^Fattura n\. .+ del /)).toBeVisible();
    await expectPhoneFriendly(page);

    // The other way: from a served plate (the dish and the day) to its batch and its lot.
    await page.goto("/tracciabilita?da=piatto");
    await main(page).getByLabel("Giorno", { exact: true }).fill(seed.day);
    await main(page).getByRole("button", { name: "Cerca", exact: true }).click();
    const plate = link(page, new RegExp(TRACE_E2E.plate));
    await expect(plate).toBeVisible();
    await plate.click();
    await page.waitForURL((url) => url.pathname.startsWith("/tracciabilita/piatto/"));
    await expect(
      main(page).getByRole("heading", { name: TRACE_E2E.plate, exact: true }),
    ).toBeVisible();
    await expect(main(page)).toContainText("Preparazioni usate");
    await expect(main(page)).toContainText("Lotti e fornitori");
    await expect(main(page)).toContainText(`lotto ${TRACE_E2E.lotCode}`);
    await expectPhoneFriendly(page);
  });

  test("a code that nobody delivered says so", async ({ page }) => {
    await signInWithMagicLink(page, seeded().email);
    await page.goto("/tracciabilita?lotto=NESSUN-LOTTO");
    await expect(main(page)).toContainText("Nessuna consegna trovata con questo codice.");
    await expect(
      main(page).getByRole("button", { name: "Prova con l'ingrediente o il fornitore" }),
    ).toBeVisible();
  });
});

test.describe("the chef", () => {
  test("reads the lot and the batch with no invoice link and no article line (AT-P1, AT-P7)", async ({
    page,
  }) => {
    const { chefEmail, seed } = seeded();
    await signInWithMagicLink(page, chefEmail);
    await page.goto(`/tracciabilita/lotto/${seed.lotId}`);
    await expect(
      main(page).getByRole("heading", { name: TRACE_E2E.coded, exact: true }),
    ).toBeVisible();
    await expect(main(page)).toContainText("Lotti di produzione (1)");
    await expect(main(page)).not.toContainText("Fattura");
    await expect(main(page)).not.toContainText("Articolo");
    await expect(link(page, /Fattura/)).toHaveCount(0);

    await page.goto(`/tracciabilita/produzione/${seed.batchId}`);
    await expect(main(page)).toContainText(`lotto ${TRACE_E2E.lotCode}`);
    await expect(main(page)).not.toContainText("Fattura");

    // The reply itself carries neither: the database does not give them to the chef.
    for (const path of [`/api/trace/lots/${seed.lotId}`, `/api/trace/batches/${seed.batchId}`]) {
      const reply = await page.request.get(path);
      expect(reply.status(), path).toBe(200);
      const text = await reply.text();
      expect(text, path).not.toContain('"invoice"');
      expect(text, path).not.toContain('"purchase"');
    }
  });
});

test.describe("the waiter", () => {
  test("gets 403 from every trace route and from the push results", async ({ page }) => {
    const { waiterEmail, seed } = seeded();
    await signInWithMagicLink(page, waiterEmail, "/tavoli");
    for (const path of [
      "/api/trace/lots?q=x",
      "/api/trace/capture",
      `/api/trace/lots/${seed.lotId}`,
      `/api/trace/batches/${seed.batchId}`,
      `/api/trace/lines?date=${seed.day}`,
      "/api/reports/push-sell-through",
    ]) {
      const refused = await page.request.get(path);
      expect(refused.status(), path).toBe(403);
    }
  });
});

test.describe("receiving", () => {
  test("marks the stock lines with no lot, counts them before the approval, and approves anyway (AT-P5)", async ({
    page,
  }) => {
    const { email, reviewInvoiceId } = seeded();
    await signInWithMagicLink(page, email);
    await page.goto(`/fatture/${reviewInvoiceId}/revisione`);
    const lines = page.getByTestId("review-line");
    await expect(lines).toHaveCount(2);
    for (const index of [0, 1]) {
      await expect(lines.nth(index).locator('[data-badge="lot-missing"]')).toHaveText(
        "Lotto mancante",
      );
    }
    const panel = page.getByTestId("approval-panel");
    await expect(panel).toContainText(
      "2 righe di magazzino senza lotto. Puoi aggiungerlo ora; dopo l'approvazione non si potrà più.",
    );
    await expectPhoneFriendly(page);

    // "Mostra la prima" opens the first marked line with the cursor in its Lotto field, and the hint is under it.
    await panel.getByRole("button", { name: "Mostra la prima", exact: true }).click();
    await expect(page.getByRole("textbox", { name: /^Lotto\s.*Copia il lotto/ })).toBeFocused();
    await expect(main(page)).toContainText(
      "Copia il lotto dall'etichetta della confezione, se c'è.",
    );

    // The approval is not blocked by the missing lots: two taps, as for any invoice.
    await panel.getByRole("button", { name: "Approva fattura", exact: true }).click();
    await panel.getByRole("button", { name: "Conferma approvazione", exact: true }).click();
    await expect(page.getByTestId("decision-badge")).toBeVisible();
  });
});

test.describe("the run", () => {
  test("did not cross the 02:00 cut-off", async ({ page }) => {
    await signInWithMagicLink(page, seeded().email);
    expect(await businessDateOf(page), "the run crossed the 02:00 cut-off").toBe(seeded().seed.day);
  });
});
