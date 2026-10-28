import { expect, test } from "@playwright/test";
import { createOwner, requireSupabaseStack, signInWithMagicLink } from "./helpers/session";

requireSupabaseStack();

// The app shell (docs/plans/2026-10-28-ux-flows.md, PR A, ADR-020) on a phone (360 x 740) and the laptop
// (1280 x 800). Fake data only. Roles are made with the helpers the other specs use.

test.describe("one main per page (A3)", () => {
  test("the public screens and the signed-in pages each have exactly one main and a wordmark link to Oggi", async ({
    page,
  }) => {
    for (const path of ["/login", "/pin"]) {
      await page.goto(path);
      await expect(page.locator("main")).toHaveCount(1);
      await expect(page.getByRole("link", { name: "Osteria Dei Rossi, Oggi" })).toHaveAttribute(
        "href",
        "/",
      );
    }

    await signInWithMagicLink(page, createOwner());
    for (const path of ["/", "/fatture"]) {
      await page.goto(path);
      await expect(page.locator("main")).toHaveCount(1);
      await expect(page.getByRole("link", { name: "Osteria Dei Rossi, Oggi" })).toHaveAttribute(
        "href",
        "/",
      );
    }
  });

  test("the wordmark leads back to Oggi from any page", async ({ page }) => {
    await signInWithMagicLink(page, createOwner());
    await page.goto("/fatture");
    await page.getByRole("link", { name: "Osteria Dei Rossi, Oggi" }).click();
    await expect(page).toHaveURL((url) => url.pathname === "/");
    await expect(page.getByTestId("role")).toHaveText("Ruolo: Titolare");
  });
});
