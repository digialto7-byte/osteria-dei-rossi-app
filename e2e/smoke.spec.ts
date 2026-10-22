import { expect, test } from "@playwright/test";
import { MIN_MEASURED_TAP_PX } from "./helpers/tap";

test("health endpoint answers ok with the baseline security headers (acceptance test 9)", async ({
  request,
}) => {
  const response = await request.get("/api/health");
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ status: "ok" });
  const headers = response.headers();
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(headers["x-powered-by"]).toBeUndefined();
});

test("a signed-out visit to / lands on the Italian login page", async ({ page }) => {
  const response = await page.goto("/");
  expect(page.url()).toMatch(/\/login\?next=%2F$/);
  expect(response?.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
  await expect(page.getByRole("heading", { name: "Accedi" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "it");
});

test("login controls are at least 44 px tall and the page has no horizontal scroll", async ({
  page,
}) => {
  await page.goto("/login");
  for (const control of [
    page.getByLabel("Email"),
    page.getByRole("button", { name: "Inviami il link" }),
  ]) {
    const box = await control.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(MIN_MEASURED_TAP_PX);
  }
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test("an expired link shows the Italian error on the login page", async ({ page }) => {
  await page.goto("/api/auth/callback?next=%2F");
  expect(new URL(page.url()).pathname).toBe("/login");
  // Next.js adds its own empty role="alert" route announcer, so match by text.
  await expect(page.getByRole("alert").filter({ hasText: "Il link non è valido" })).toBeVisible();
});

test("the callback never redirects off-site (acceptance test 12)", async ({ request }) => {
  for (const next of ["https://evil.example", "//evil.example"]) {
    const response = await request.get(
      `/api/auth/callback?code=bogus&next=${encodeURIComponent(next)}`,
      {
        maxRedirects: 0,
      },
    );
    expect(response.status()).toBe(303);
    expect(new URL(response.headers().location ?? "", "http://localhost:3000").origin).toBe(
      "http://localhost:3000",
    );
  }
});

test("API errors are JSON without stack traces (acceptance test 5)", async ({ request }) => {
  const unauthenticated = await request.get("/api/me");
  expect(unauthenticated.status()).toBe(401);
  expect(await unauthenticated.json()).toEqual({
    error: { code: "unauthenticated", message: expect.any(String) },
  });

  const unknownField = await request.post("/api/auth/magic-link", {
    data: { email: "owner@example.test", isAdmin: true },
  });
  expect(unknownField.status()).toBe(400);
  const body = await unknownField.text();
  expect(JSON.parse(body).error.code).toBe("invalid_request");
  expect(body).not.toMatch(/\bat \S+:\d+/);
});
