import { expect, test, type Page } from "@playwright/test";
import { admin, seedApprovedPayable, tenantIdOf } from "./helpers/seed-invoice";
import {
  createOwner,
  createStaff,
  expectPhoneFriendly,
  requireSupabaseStack,
  signInWithMagicLink,
} from "./helpers/session";

requireSupabaseStack();

// M9 acceptance tests on screen: payables on a phone (360 x 740) and the laptop layout (1280 x 800).
// The owner approves a seeded fake invoice (gross 1.234,50 EUR) through the real API; every action
// after that goes through the screens. Dates are matched by shape or read from the API: they are
// Europe/Rome dates of "now", and the due date of the seeded invoice is fixed (29/10/2026), so how
// many days it is late depends on the day the test runs. Fake data only.

const SUPPLIER = "Fornitore Demo Srl";
const nav = (page: Page) => page.getByRole("navigation", { name: "Menu principale" });
/** A tab of the phone's bottom bar: the group word, shown once the role is known. */
const tab = (page: Page, group: string) =>
  page.getByRole("navigation", { name: "Sezioni" }).getByRole("link", { name: group, exact: true });
const statusForm = (page: Page) =>
  page.getByRole("form", { name: "Cambia lo stato del pagamento" });
const savedNote = (page: Page, text: string) => page.getByRole("status").filter({ hasText: text });

/** Dark and light, as the other signed-in specs do. */
async function expectPhoneFriendlyBothThemes(page: Page) {
  await expectPhoneFriendly(page);
  await page.emulateMedia({ colorScheme: "dark" });
  await expectPhoneFriendly(page);
  await page.emulateMedia({ colorScheme: "light" });
}

/** A signed-in owner with one approved invoice, i.e. one open payable. */
async function setup(page: Page) {
  await signInWithMagicLink(page, createOwner());
  const tenantId = await tenantIdOf(page);
  const seeded = await seedApprovedPayable(page, admin(), tenantId);
  return { ...seeded, tenantId };
}

/** Signs the current browser out and in as someone else of the same tenant. */
async function switchTo(page: Page, role: "admin" | "chef", tenantId: string) {
  await page.context().clearCookies();
  await signInWithMagicLink(page, await createStaff(tenantId, role));
}

test.describe("payables on a phone (360 px)", () => {
  test("the owner sees the payable, marks it paid and reverses the payment with a reason (AT5 on screen)", async ({
    page,
  }) => {
    const { payableId } = await setup(page);

    // The list: supplier, amount, a status word, and the totals line.
    await page.goto("/pagamenti");
    await expect(page.getByRole("heading", { name: "Pagamenti", exact: true })).toBeVisible();
    await expect(nav(page).getByRole("link", { name: "Pagamenti", exact: true })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(page.getByText("1 fattura da pagare · 1.234,50 €")).toBeVisible();
    const row = page
      .getByRole("listitem")
      .filter({ has: page.getByRole("link", { name: SUPPLIER, exact: true }) });
    await expect(row).toContainText("1.234,50 €");
    await expect(row).toContainText("Da pagare");
    await expect(row).toContainText("Fattura FT");
    await expectPhoneFriendlyBothThemes(page);

    // The detail: the facts and the status form.
    await row.getByRole("link", { name: SUPPLIER, exact: true }).click();
    await expect(page.getByRole("heading", { name: SUPPLIER })).toBeVisible();
    await expect(page.getByTestId("fact-amount")).toContainText("1.234,50 €");
    await expect(page.getByTestId("fact-due-date")).toContainText(
      "29/10/2026 (dai termini del fornitore)",
    );
    await expect(page.getByTestId("fact-status")).toHaveText("Da pagare");
    await expect(page.getByRole("button", { name: "Annulla pagamento" })).toHaveCount(0);

    const { today } = (await (await page.request.get(`/api/payables/${payableId}`)).json()) as {
      today: string;
    };
    const form = statusForm(page);
    await expect(form.getByLabel("Data del pagamento")).toHaveValue(today);
    await expect(form).toContainText("Non inserire dati personali.");
    await expect(form.getByRole("button", { name: "Segna come programmata" })).toBeVisible();
    await expect(form.getByRole("button", { name: "Segna come contestata" })).toBeVisible();
    await expect(form.getByRole("button", { name: "Riporta a da pagare" })).toHaveCount(0);
    await expectPhoneFriendlyBothThemes(page);

    // Mark it paid.
    await form.getByRole("button", { name: "Segna come pagata" }).click();
    await expect(savedNote(page, "Pagamento registrato.")).toBeVisible();
    await expect(page.getByTestId("fact-status")).toContainText("Pagata il");
    await expect(statusForm(page)).toHaveCount(0);
    await expect(page.getByRole("listitem").filter({ hasText: "Pagata il" })).toHaveCount(1);

    // A paid payable offers only the reversal, in two taps, and the reason is required.
    await page.getByRole("button", { name: "Annulla pagamento" }).click();
    const reverse = page.getByRole("form", { name: "Annulla il pagamento" });
    await expect(reverse).toContainText("resta nello storico");
    await expectPhoneFriendlyBothThemes(page);
    await reverse.getByRole("button", { name: "Conferma annullamento" }).click();
    // The browser blocks the submit: the required field is still empty and nothing was saved.
    expect(
      await reverse
        .getByLabel("Motivo")
        .evaluate((el) => (el as HTMLInputElement).validity.valueMissing),
    ).toBe(true);
    await expect(savedNote(page, "Pagamento annullato.")).toHaveCount(0);

    await reverse.getByLabel("Motivo").fill("Registrato per errore");
    await reverse.getByRole("button", { name: "Conferma annullamento" }).click();
    await expect(savedNote(page, "Pagamento annullato.")).toBeVisible();
    await expect(page.getByTestId("fact-status")).toHaveText("Da pagare");
    await expect(statusForm(page)).toBeVisible();

    // The history keeps the payment and its reversal, with the reason as text.
    const reversed = page.getByRole("listitem").filter({ hasText: "Registrato per errore" });
    await expect(reversed).toContainText("Pagamento annullato");
    await expect(reversed).toContainText("Motivo: Registrato per errore");
    await expect(page.getByRole("listitem").filter({ hasText: /^Pagata il/ })).toHaveCount(1);
    await expectPhoneFriendlyBothThemes(page);
  });

  test("the supplier page leads to the statement with the balance (AT4 on screen)", async ({
    page,
  }) => {
    const { supplierId } = await setup(page);
    await page.goto(`/anagrafiche/fornitori/${supplierId}`);
    await expect(page.getByRole("heading", { name: SUPPLIER })).toBeVisible();
    await page.getByRole("link", { name: "Estratto conto", exact: true }).click();

    await expect(page.getByRole("heading", { name: "Estratto conto", exact: true })).toBeVisible();
    await expect(page.getByTestId("statement-invoices")).toContainText("1.234,50 €");
    await expect(page.getByTestId("statement-balance")).toContainText("1.234,50 €");
    await expect(page.getByTestId("statement-disputed")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Fatture aperte", exact: true })).toBeVisible();
    await expect(page.getByRole("listitem").filter({ hasText: "Fattura FT" })).toHaveCount(1);
    await expectPhoneFriendlyBothThemes(page);
  });

  test("the admin can schedule a payment; a disputed one shows in the statement as disputed", async ({
    page,
  }) => {
    const { payableId, supplierId, tenantId } = await setup(page);
    await switchTo(page, "admin", tenantId);
    await page.goto(`/pagamenti/${payableId}`);
    await expect(page.getByRole("heading", { name: SUPPLIER })).toBeVisible();

    await statusForm(page).getByRole("button", { name: "Segna come programmata" }).click();
    await expect(savedNote(page, "Stato aggiornato.")).toBeVisible();
    await expect(page.getByTestId("fact-status")).toHaveText("Programmata");
    // From scheduled, "Riporta a da pagare" is offered and "Segna come programmata" is not.
    await expect(
      statusForm(page).getByRole("button", { name: "Riporta a da pagare" }),
    ).toBeVisible();
    await expect(
      statusForm(page).getByRole("button", { name: "Segna come programmata" }),
    ).toHaveCount(0);

    await statusForm(page).getByLabel("Nota").fill("Merce da verificare");
    await statusForm(page).getByRole("button", { name: "Segna come contestata" }).click();
    await expect(page.getByTestId("fact-status")).toHaveText("Contestata");
    // The saved note went into the audit trail; it must not wait in the form for the next change.
    await expect(statusForm(page).getByLabel("Nota")).toHaveValue("");

    await page.goto(`/anagrafiche/fornitori/${supplierId}/estratto-conto`);
    await expect(page.getByTestId("statement-disputed")).toContainText("1.234,50 €");
    await expectPhoneFriendly(page);
  });

  test("the chef has no Pagamenti tab, no statement link and is refused on the screen and in the API (AT6 on screen)", async ({
    page,
  }) => {
    const { payableId, supplierId, tenantId } = await setup(page);
    await switchTo(page, "chef", tenantId);

    await page.goto("/pagamenti");
    // The role arrives with /api/me; the chef's "Cucina" tab shows once it is known, so the absence below is real.
    await expect(tab(page, "Cucina")).toBeVisible();
    await expect(page.locator('a[href="/pagamenti"]')).toHaveCount(0);
    await expect(nav(page).getByRole("link", { name: "Pagamenti", exact: true })).toHaveCount(0);
    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: "I pagamenti non sono disponibili per il tuo ruolo." }),
    ).toBeVisible();
    await expect(page.getByRole("listitem")).toHaveCount(0);

    await page.goto(`/anagrafiche/fornitori/${supplierId}`);
    await expect(page.getByRole("heading", { name: SUPPLIER })).toBeVisible();
    await expect(tab(page, "Cucina")).toBeVisible();
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("link", { name: "Estratto conto", exact: true })).toHaveCount(0);

    expect((await page.request.get("/api/payables")).status()).toBe(403);
    expect((await page.request.get(`/api/payables/${payableId}`)).status()).toBe(403);
    expect((await page.request.get(`/api/suppliers/${supplierId}/statement`)).status()).toBe(403);
    const patch = await page.request.patch(`/api/payables/${payableId}`, {
      data: { status: "scheduled" },
    });
    expect(patch.status()).toBe(403);
    await expectPhoneFriendly(page);
  });
});

test.describe("payables on a laptop (1280 px)", () => {
  test.use({ viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false });

  test("the payables screens stay within the page column", async ({ page }) => {
    const { payableId } = await setup(page);
    for (const path of ["/pagamenti", `/pagamenti/${payableId}`]) {
      await page.goto(path);
      await expect(
        page
          .getByRole("link", { name: SUPPLIER })
          .or(page.getByRole("heading", { name: SUPPLIER }))
          .first(),
      ).toBeVisible();
      const main = (await page.locator("main").boundingBox())!;
      const content = (await page.locator("main > *").last().boundingBox())!;
      expect(content.x).toBeGreaterThanOrEqual(main.x);
      expect(content.x + content.width).toBeLessThanOrEqual(main.x + main.width + 1);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    }
  });
});
