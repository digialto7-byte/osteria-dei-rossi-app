import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import config from "../../playwright.config";

// M18 step 16: Chromium phone for every spec, plus a WebKit (iPhone) project for the order screen only. The
// order screen is what a waiter holds at the table, and WebKit differs from Chromium in ways that bit us before
// (no crypto.randomUUID on plain http, form control sizes), so one spec runs there as well.
const projects = config.projects ?? [];
const byName = (name: string) => projects.find((project) => project.name === name);

describe("playwright projects", () => {
  it("has exactly the phone and phone-webkit projects", () => {
    expect(projects.map((project) => project.name)).toEqual(["phone", "phone-webkit"]);
  });

  it("phone is still Chromium (Pixel 7) at 360 x 740 and runs every spec", () => {
    const phone = byName("phone")!;
    expect(phone.use?.viewport).toEqual({ width: 360, height: 740 });
    expect(phone.use?.defaultBrowserType ?? "chromium").toBe("chromium");
    expect(phone.testMatch).toBeUndefined();
  });

  it("phone-webkit is WebKit at 360 x 740 and matches only order-entry.spec.ts", () => {
    const webkit = byName("phone-webkit")!;
    expect(webkit.use?.defaultBrowserType).toBe("webkit");
    expect(webkit.use?.viewport).toEqual({ width: 360, height: 740 });
    expect(webkit.use?.isMobile).toBe(true);
    const match = webkit.testMatch as RegExp;
    expect(match).toBeInstanceOf(RegExp);
    expect(match.test("/repo/e2e/order-entry.spec.ts")).toBe(true);
    for (const other of ["menu-tables.spec.ts", "batches.spec.ts", "order-entry-helper.spec.ts"]) {
      expect(match.test(`/repo/e2e/${other}`), other).toBe(false);
    }
  });

  it("the order-entry spec exists", () => {
    expect(() =>
      readFileSync(new URL("../../e2e/order-entry.spec.ts", import.meta.url)),
    ).not.toThrow();
  });
});

describe("CI installs the WebKit browser next to Chromium", () => {
  const ci = readFileSync(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8");
  const job = ci.slice(ci.indexOf("  supabase:"), ci.indexOf("  t1-spike:"));

  it("the supabase job installs chromium and webkit with their system dependencies, before the tests", () => {
    const install = /npx playwright install --with-deps chromium webkit/.exec(job);
    expect(install).not.toBeNull();
    expect(job.indexOf("npx playwright install")).toBeLessThan(job.indexOf("npx playwright test"));
    expect(ci.match(/npx playwright install/g)).toHaveLength(1);
  });
});
