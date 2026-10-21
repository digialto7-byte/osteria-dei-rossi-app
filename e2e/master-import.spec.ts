import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { createOwner, requireSupabaseStack, signInWithMagicLink } from "./helpers/session";

requireSupabaseStack();

const SUPPLIERS_CSV = fileURLToPath(
  new URL("../tests/fixtures/import/fornitori-demo.csv", import.meta.url),
);

test("importing the same supplier file twice changes nothing the second time (acceptance test 5)", async ({
  page,
}) => {
  await signInWithMagicLink(page, createOwner());
  await page.goto("/anagrafiche/importa");

  await page.getByLabel("File CSV").setInputFiles(SUPPLIERS_CSV);
  await page.getByRole("button", { name: "Importa" }).click();
  await expect(page.getByRole("status")).toHaveText("3 creati, 0 aggiornati, 0 invariati");

  await page.getByRole("button", { name: "Importa" }).click();
  await expect(page.getByRole("status")).toHaveText("0 creati, 0 aggiornati, 3 invariati");

  const response = await page.request.get("/api/suppliers");
  expect((await response.json()).suppliers).toHaveLength(3);
});
