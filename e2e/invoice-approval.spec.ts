import { expect, test, type Page } from "@playwright/test";
import { admin, seedApprovableInvoice, tenantIdOf } from "./helpers/seed-invoice";
import {
  createOwner,
  expectPhoneFriendly,
  requireSupabaseStack,
  signInWithMagicLink,
} from "./helpers/session";

requireSupabaseStack();

// M5 acceptance tests on screen: approving and rejecting an invoice on a phone (360 x 740) and the
// laptop layout (1280 x 800). The invoice is seeded in the state the review leaves behind (a
// supplier with 30 payment days, the location "Cella", four mapped lines, gross 1.234,50 EUR);
// every action goes through the real API and database. Fake data only.

/** A signed-in owner with an approvable invoice. */
async function setup(page: Page, options: { grossTotal?: number; withFile?: boolean } = {}) {
  await signInWithMagicLink(page, createOwner());
  const tenantId = await tenantIdOf(page);
  const seeded = await seedApprovableInvoice(admin(), tenantId, options);
  return { ...seeded, path: `/fatture/${seeded.invoiceId}/revisione` };
}

const panelOf = (page: Page) => page.getByTestId("approval-panel");
const rowOf = (page: Page, text: string) =>
  page.getByTestId("review-line").filter({ hasText: text });
const status = (page: Page) => page.getByTestId("invoice-status");

/** The two taps of an approval. */
async function approve(page: Page) {
  await panelOf(page).getByRole("button", { name: "Approva fattura" }).click();
  await panelOf(page).getByRole("button", { name: "Conferma approvazione" }).click();
}

/** The decision time as the venue writes it: Europe/Rome, whatever the browser's zone is. */
function romeTime(iso: string): string {
  return new Intl.DateTimeFormat("it-IT", {
    timeZone: "Europe/Rome",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(iso));
}

test.describe("approval on a phone (360 px)", () => {
  // The browser is far from Rome on purpose: the decision time must not follow it.
  test.use({ timezoneId: "America/New_York" });

  test("shows the payable, then approves in two taps and shows the decision (AT3 on screen)", async ({
    page,
  }) => {
    const { invoiceId, path } = await setup(page);
    await page.goto(path);
    const panel = panelOf(page);
    await expect(panel.getByTestId("approval-payable")).toContainText(
      "Da pagare 1.234,50 € entro il 29/10/2026 · dai termini del fornitore",
    );
    await expect(panel.getByTestId("approval-receipts")).toContainText(
      "Carico del 29/09/2026 · 4 carichi in Cella",
    );
    await expect(panel.getByTestId("approval-blockers")).toHaveCount(0);
    await expect(rowOf(page, "Passata di pomodoro")).toContainText("Da caricare: 12 kg");
    await expect(rowOf(page, "Farina 00")).toContainText("Da caricare: 4 kg");
    await expect(status(page)).toHaveText("Da controllare");

    // Light and dark with the panel in view.
    await expectPhoneFriendly(page);
    await page.emulateMedia({ colorScheme: "dark" });
    await expectPhoneFriendly(page);
    await page.emulateMedia({ colorScheme: "light" });

    // First tap: only the confirmation appears. Nothing is approved yet, and it says why it is final.
    await panel.getByRole("button", { name: "Approva fattura" }).click();
    await expect(panel.getByTestId("approval-confirm")).toContainText(
      "Registra 4 carichi e un debito di 1.234,50 €. Non si può annullare.",
    );
    await expect(panel.getByRole("button", { name: "Approva fattura" })).toHaveCount(0);
    await expect(status(page)).toHaveText("Da controllare");
    await expectPhoneFriendly(page);
    await page.emulateMedia({ colorScheme: "dark" });
    await expectPhoneFriendly(page);
    await page.emulateMedia({ colorScheme: "light" });

    // "Annulla" goes back; the second tap approves.
    await panel.getByRole("button", { name: "Annulla" }).click();
    await expect(panel.getByRole("button", { name: "Approva fattura" })).toBeEnabled();
    await approve(page);

    await expect(status(page)).toHaveText("Approvata");
    await expect(panel.getByTestId("decision-badge")).toHaveText("Approvata");
    const review = (await (await page.request.get(`/api/invoices/${invoiceId}/review`)).json()) as {
      review: { decision: { at: string }; posting: { payable: { amount: number } } };
    };
    await expect(panel.getByTestId("decision-line")).toContainText(
      `il ${romeTime(review.review.decision.at)}`,
    );
    await expect(panel.getByTestId("posted-payable")).toContainText("Da pagare 1.234,50 €");
    await expect(panel).toContainText("Ubicazione: Cella");
    await expect(panel.getByRole("status")).toContainText("Non si può annullare");
    await expect(panel.getByRole("button")).toHaveCount(0);
    await expect(rowOf(page, "Passata di pomodoro")).toContainText("Caricato: 12 kg");
    await expect(rowOf(page, "Fesa di manzo")).toContainText("Caricato: 53 kg");
    expect(review.review.posting.payable.amount).toBe(1234.5);

    await expectPhoneFriendly(page);
    await page.emulateMedia({ colorScheme: "dark" });
    await expectPhoneFriendly(page);

    // It is still approved after a reload, and nothing offers to approve it again.
    await page.reload();
    await expect(panelOf(page).getByTestId("decision-badge")).toHaveText("Approvata");
    await expect(page.getByRole("button", { name: "Approva fattura" })).toHaveCount(0);
  });

  test("a total that does not match shows why, keeps 'Approva fattura' disabled, and opens once fixed (AT1 on screen)", async ({
    page,
  }) => {
    const { invoiceId, path } = await setup(page, { grossTotal: 1235.5 });
    await page.goto(path);
    const panel = panelOf(page);
    const blockers = panel.getByTestId("approval-blockers");
    await expect(blockers).toContainText("Il totale non corrisponde");
    const button = panel.getByRole("button", { name: "Approva fattura" });
    await expect(button).toBeDisabled();
    // The reason is tied to the button for assistive technology, and it is words, not colour.
    const listId = await blockers.getAttribute("id");
    await expect(button).toHaveAttribute("aria-describedby", listId!);
    await expect(status(page)).toHaveText("Da controllare");
    await expectPhoneFriendly(page);
    await page.emulateMedia({ colorScheme: "dark" });
    await expectPhoneFriendly(page);
    await page.emulateMedia({ colorScheme: "light" });

    // Correcting the total (what the header editor sends) lifts the blocker.
    const fixed = await page.request.patch(`/api/invoices/${invoiceId}`, {
      data: { grossTotal: 1234.5 },
    });
    expect(fixed.status()).toBe(200);
    await page.reload();
    await expect(panelOf(page).getByTestId("approval-blockers")).toHaveCount(0);
    await expect(panelOf(page).getByRole("button", { name: "Approva fattura" })).toBeEnabled();
  });

  test("rejecting with a reason shows the badge and the reason; it cannot be approved afterwards", async ({
    page,
  }) => {
    const { path } = await setup(page);
    await page.goto(path);
    const panel = panelOf(page);

    await panel.getByRole("button", { name: "Rifiuta" }).click();
    const form = panel.getByRole("form", { name: "Rifiuta la fattura" });
    await expect(form.getByLabel("Motivo (facoltativo)")).toBeVisible();
    await expect(form).toContainText("Non inserire dati personali.");
    await expectPhoneFriendly(page);
    await page.emulateMedia({ colorScheme: "dark" });
    await expectPhoneFriendly(page);
    await page.emulateMedia({ colorScheme: "light" });

    // "Annulla" closes the form; opening it again starts empty and the tap is confirmed once more.
    await form.getByRole("button", { name: "Annulla" }).click();
    await expect(panel.getByRole("form")).toHaveCount(0);
    await panel.getByRole("button", { name: "Rifiuta" }).click();
    await form.getByLabel("Motivo (facoltativo)").fill("Fattura non nostra");
    await form.getByRole("button", { name: "Conferma rifiuto" }).click();

    await expect(status(page)).toHaveText("Rifiutata");
    await expect(panel.getByTestId("decision-badge")).toHaveText("Rifiutata");
    await expect(panel.getByTestId("decision-reason")).toHaveText("Motivo: Fattura non nostra");
    await expect(panel.getByRole("button")).toHaveCount(0);
    await expect(rowOf(page, "Passata di pomodoro")).not.toContainText("Da caricare");
    await expectPhoneFriendly(page);
  });

  test("approved in another tab: the second tab says so, then shows the decision", async ({
    page,
  }) => {
    const { path } = await setup(page);
    await page.goto(path);
    const second = await page.context().newPage();
    await second.goto(path);
    await expect(panelOf(second).getByRole("button", { name: "Approva fattura" })).toBeEnabled();

    await approve(page);
    await expect(status(page)).toHaveText("Approvata");

    // The second tab still shows the invoice as open: its approval is refused with the Italian reason.
    await approve(second);
    // Filtered: Next's route announcer is also role="alert" at page level.
    await expect(
      second.getByRole("alert").filter({ hasText: "La fattura è già stata approvata." }),
    ).toBeVisible();
    await expect(panelOf(second).getByTestId("decision-badge")).toHaveText("Approvata");
    await expect(second.getByRole("button", { name: "Approva fattura" })).toHaveCount(0);
    await expectPhoneFriendly(second);
  });
});

test.describe("approval on a laptop (1280 px)", () => {
  test.use({ viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false });

  test("the panel sits in the right column under the lines, and approving works there", async ({
    page,
  }) => {
    const { path } = await setup(page, { withFile: true });
    await page.goto(path);
    const frame = page.locator('iframe[title="Documento della fattura"]');
    await expect(frame).toBeVisible();
    const panel = panelOf(page);
    await expect(panel).toBeVisible();

    const frameBox = (await frame.boundingBox())!;
    const panelBox = (await panel.boundingBox())!;
    const lastLine = (await page.getByTestId("review-line").last().boundingBox())!;
    expect(panelBox.x).toBeGreaterThanOrEqual(frameBox.x + frameBox.width);
    expect(panelBox.y).toBeGreaterThanOrEqual(lastLine.y + lastLine.height - 1);
    await expectPhoneFriendly(page);

    await approve(page);
    await expect(status(page)).toHaveText("Approvata");
    await expect(rowOf(page, "Passata di pomodoro")).toContainText("Caricato: 12 kg");
    await expectPhoneFriendly(page);

    // Only the review page goes wide; the invoice list uses the list column (UX plan C7: up to max-w-3xl, 768 px).
    await page.goto("/fatture");
    await expect(page.getByRole("heading", { name: "Fatture" })).toBeVisible();
    const list = (await page.locator("main").boundingBox())!;
    expect(list.width).toBeGreaterThan(448);
    expect(Math.abs(list.width - 768)).toBeLessThan(1);
  });
});
