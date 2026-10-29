import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import config from "../../playwright.config";

// M18 step 16: Chromium phone for every spec, plus a WebKit (iPhone) project for the order screen only. The
// order screen is what a waiter holds at the table, and WebKit differs from Chromium in ways that bit us before
// (no crypto.randomUUID on plain http, form control sizes), so one spec runs there as well.
// M19 step 19: the WebKit project also runs the firing spec (the waiter's send and void), and a `laptop` project (Chromium,
// 1280 x 800) runs the kitchen spec only: the kitchen list is read on a laptop or tablet at the pass as well as on a phone.
const projects = config.projects ?? [];
const byName = (name: string) => projects.find((project) => project.name === name);

describe("playwright projects", () => {
  it("has exactly the phone, phone-webkit and laptop projects", () => {
    expect(projects.map((project) => project.name)).toEqual(["phone", "phone-webkit", "laptop"]);
  });

  it("phone is still Chromium (Pixel 7) at 360 x 740 and runs every spec", () => {
    const phone = byName("phone")!;
    expect(phone.use?.viewport).toEqual({ width: 360, height: 740 });
    expect(phone.use?.defaultBrowserType ?? "chromium").toBe("chromium");
    expect(phone.testMatch).toBeUndefined();
  });

  it("phone-webkit is WebKit at 360 x 740 and matches only the order-entry, firing and offline specs", () => {
    const webkit = byName("phone-webkit")!;
    expect(webkit.use?.defaultBrowserType).toBe("webkit");
    expect(webkit.use?.viewport).toEqual({ width: 360, height: 740 });
    expect(webkit.use?.isMobile).toBe(true);
    const match = webkit.testMatch as RegExp;
    expect(match).toBeInstanceOf(RegExp);
    expect(match.test("/repo/e2e/order-entry.spec.ts")).toBe(true);
    expect(match.test("/repo/e2e/firing.spec.ts")).toBe(true);
    expect(match.test("/repo/e2e/offline.spec.ts")).toBe(true);
    for (const other of [
      "pwa.spec.ts",
      "offline-helper.spec.ts",
      "menu-tables.spec.ts",
      "batches.spec.ts",
      "kitchen.spec.ts",
      "order-entry-helper.spec.ts",
      "firing-helper.spec.ts",
    ]) {
      expect(match.test(`/repo/e2e/${other}`), other).toBe(false);
    }
  });

  it("laptop is Chromium at 1280 x 800 and matches only kitchen.spec.ts", () => {
    const laptop = byName("laptop")!;
    expect(laptop.use?.defaultBrowserType ?? "chromium").toBe("chromium");
    expect(laptop.use?.viewport).toEqual({ width: 1280, height: 800 });
    expect(laptop.use?.isMobile).toBeFalsy();
    const match = laptop.testMatch as RegExp;
    expect(match).toBeInstanceOf(RegExp);
    expect(match.test("/repo/e2e/kitchen.spec.ts")).toBe(true);
    for (const other of ["firing.spec.ts", "order-entry.spec.ts", "kitchen-helper.spec.ts"]) {
      expect(match.test(`/repo/e2e/${other}`), other).toBe(false);
    }
  });

  it("the phone project runs the kitchen spec too (it has no testMatch)", () => {
    expect(byName("phone")!.testMatch).toBeUndefined();
  });

  it("the order-entry, firing and kitchen specs exist", () => {
    for (const spec of ["order-entry", "firing", "kitchen", "offline", "pwa"]) {
      expect(() =>
        readFileSync(new URL(`../../e2e/${spec}.spec.ts`, import.meta.url)),
      ).not.toThrow();
    }
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
