import { expect, test } from "@playwright/test";
import { newContext, openTableAndOrder } from "./helpers/order-ui";
import { tenantIdOf } from "./helpers/seed-invoice";
import { WAITER_A, createWaiter, seedTables } from "./helpers/seed-menu-tables";
import { createOwner, requireSupabaseStack, signInWithMagicLink } from "./helpers/session";

requireSupabaseStack();

// Pins the Heading wrap (#145: `[overflow-wrap:anywhere]` on the h1). A table name from the data that is one long word, with no space to break at,
// must not push the comanda's page sideways at 360 px. Fake data only.

const LONG_NAME = "Tavolodemoconnomelunghissimosenzaspazi";

test.describe("Heading wrap", () => {
  test.setTimeout(120_000);

  test("a long single-word table name in the comanda h1 does not scroll the page sideways at 360 px", async ({
    page,
    browser,
  }, testInfo) => {
    await signInWithMagicLink(page, createOwner());
    const tenantId = await tenantIdOf(page);
    const tables = await seedTables(page, [LONG_NAME]);

    const { context, page: phone } = await newContext(browser, testInfo.project.use);
    try {
      await signInWithMagicLink(phone, await createWaiter(tenantId, WAITER_A), "/tavoli");
      await openTableAndOrder(phone, tables[LONG_NAME]!);

      await expect(phone.getByRole("heading", { level: 1, name: LONG_NAME })).toBeVisible();
      await expect
        .poll(() =>
          phone.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
          ),
        )
        .toBeLessThanOrEqual(0);
    } finally {
      await context.close();
    }
  });
});
