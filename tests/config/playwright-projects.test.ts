import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import config from "../../playwright.config";

// M18 step 16: Chromium phone for every spec, plus a WebKit (iPhone) project for the order screen only. The
// order screen is what a waiter holds at the table, and WebKit differs from Chromium in ways that bit us before
// (no crypto.randomUUID on plain http, form control sizes), so one spec runs there as well.
// M19 step 19: the WebKit project also runs the firing spec (the waiter's send and void), and a `laptop` project (Chromium,
// 1280 x 800) runs the kitchen spec only: the kitchen list is read on a laptop or tablet at the pass as well as on a phone.
// M21 step 17: the WebKit project also runs the bill-close spec (the waiter's bill, split and close); the end-of-day spec is the owner's
// and stays on Chromium (`phone`).
// M25 step 4: the WebKit project also runs the security-headers spec (the nonce is checked on the iPhone's engine too).
// M25 step 16: a fifth project, `service-sim` (Chromium, 360 x 740), matches only e2e/simulation/ (the service simulation, AT1); the other four ignore that folder.
// M25a step 16: the WebKit project also runs the session-persistence spec (the cookies' expiry and a relaunched browser); the password-login spec
// stays on Chromium (`phone`).
const projects = config.projects ?? [];
const byName = (name: string) => projects.find((project) => project.name === name);

describe("playwright projects", () => {
  it("has exactly the phone, phone-webkit, laptop, perf-4g and service-sim projects", () => {
    expect(projects.map((project) => project.name)).toEqual([
      "phone",
      "phone-webkit",
      "laptop",
      "perf-4g",
      "service-sim",
    ]);
  });

  // M25 step 16 (AT1): the service simulation is one long Chromium test at phone size. Its project matches only e2e/simulation/; the four
  // others ignore that folder (with e2e/perf/, in one combined pattern), so `npx playwright test` runs it exactly once, as `service-sim`, and
  // `--project service-sim` runs nothing else. Service workers stay on (unset): the offline stage needs the worker.
  it("service-sim is Chromium at 360 x 740, matches only e2e/simulation/ and leaves service workers on", () => {
    const sim = byName("service-sim")!;
    expect(sim.use?.defaultBrowserType ?? "chromium").toBe("chromium");
    expect(sim.use?.viewport).toEqual({ width: 360, height: 740 });
    expect(sim.use?.serviceWorkers).toBeUndefined();
    const match = sim.testMatch as RegExp;
    expect(match).toBeInstanceOf(RegExp);
    expect(match.test("/repo/e2e/simulation/service.spec.ts")).toBe(true);
    for (const other of [
      "/repo/e2e/services.spec.ts",
      "/repo/e2e/simulation.spec.ts",
      "/repo/e2e/perf/dashboard-4g.spec.ts",
      "/repo/e2e/reports.spec.ts",
    ]) {
      expect(match.test(other), other).toBe(false);
    }
  });

  it("phone, phone-webkit and laptop ignore both e2e/simulation/ and e2e/perf/, and perf-4g still matches only e2e/perf/", () => {
    for (const name of ["phone", "phone-webkit", "laptop"]) {
      const ignore = byName(name)!.testIgnore as RegExp;
      expect(ignore, name).toBeInstanceOf(RegExp);
      expect(ignore.test("/repo/e2e/simulation/service.spec.ts"), name).toBe(true);
      expect(ignore.test("/repo/e2e/perf/dashboard-4g.spec.ts"), name).toBe(true);
      expect(ignore.test("/repo/e2e/services.spec.ts"), name).toBe(false);
      expect(ignore.test("/repo/e2e/simulation.spec.ts"), name).toBe(false);
    }
    const perf = byName("perf-4g")!.testMatch as RegExp;
    expect(perf.test("/repo/e2e/simulation/service.spec.ts")).toBe(false);
  });

  it("the shared order helper opens a table with 4 covers unless the caller gives another number", () => {
    const helper = readFileSync(new URL("../../e2e/helpers/order-ui.ts", import.meta.url), "utf8");
    expect(helper).toMatch(/openTableAndOrder\(\s*page: Page,\s*tableId: string,\s*covers = 4/);
    expect(helper).toContain("fill(String(covers))");
  });

  // M22 step 18: the dashboard's Slow 4G timing is Chromium too, but it targets the staging app and runs only from its own workflow.
  // Its project matches only e2e/perf/, no other project matches that folder, and the spec skips itself unless the workflow's
  // explicit opt-in is set, so `npx playwright test` in CI never touches staging.
  it("perf-4g is Chromium, matches only e2e/perf/, and no other project runs that folder", () => {
    const perf = byName("perf-4g")!;
    expect(perf.use?.defaultBrowserType ?? "chromium").toBe("chromium");
    const match = perf.testMatch as RegExp;
    expect(match).toBeInstanceOf(RegExp);
    expect(match.test("/repo/e2e/perf/dashboard-4g.spec.ts")).toBe(true);
    expect(match.test("/repo/e2e/reports.spec.ts")).toBe(false);
    for (const name of ["phone", "phone-webkit", "laptop"]) {
      const ignore = byName(name)!.testIgnore as RegExp;
      expect(ignore, name).toBeInstanceOf(RegExp);
      expect(ignore.test("/repo/e2e/perf/dashboard-4g.spec.ts"), name).toBe(true);
      expect(ignore.test("/repo/e2e/reports.spec.ts"), name).toBe(false);
    }
  });

  it("the perf spec skips itself unless the workflow's staging opt-in is set", () => {
    const spec = readFileSync(
      new URL("../../e2e/perf/dashboard-4g.spec.ts", import.meta.url),
      "utf8",
    );
    expect(spec).toMatch(/test\.skip\([^)]*PERF_STAGING_OK/);
  });

  it("phone is still Chromium (Pixel 7) at 360 x 740 and runs every spec", () => {
    const phone = byName("phone")!;
    expect(phone.use?.viewport).toEqual({ width: 360, height: 740 });
    expect(phone.use?.defaultBrowserType ?? "chromium").toBe("chromium");
    expect(phone.testMatch).toBeUndefined();
  });

  it("phone-webkit is WebKit at 360 x 740 and matches only the order-entry, firing, offline, bill-close, session-persistence and security-headers specs", () => {
    const webkit = byName("phone-webkit")!;
    expect(webkit.use?.defaultBrowserType).toBe("webkit");
    expect(webkit.use?.viewport).toEqual({ width: 360, height: 740 });
    expect(webkit.use?.isMobile).toBe(true);
    const match = webkit.testMatch as RegExp;
    expect(match).toBeInstanceOf(RegExp);
    expect(match.test("/repo/e2e/order-entry.spec.ts")).toBe(true);
    expect(match.test("/repo/e2e/firing.spec.ts")).toBe(true);
    expect(match.test("/repo/e2e/offline.spec.ts")).toBe(true);
    expect(match.test("/repo/e2e/bill-close.spec.ts")).toBe(true);
    // M25a: cookie persistence is checked on the iPhone's engine too; the password sign-in spec stays on Chromium.
    expect(match.test("/repo/e2e/session-persistence.spec.ts")).toBe(true);
    // M25 step 4: the nonce and the CSP violations are checked on the iPhone's engine too.
    expect(match.test("/repo/e2e/security-headers.spec.ts")).toBe(true);
    for (const other of [
      "password-login.spec.ts",
      "pwa.spec.ts",
      "offline-helper.spec.ts",
      "menu-tables.spec.ts",
      "batches.spec.ts",
      "kitchen.spec.ts",
      "order-entry-helper.spec.ts",
      "firing-helper.spec.ts",
      "day-close.spec.ts",
      "bill-close-helper.spec.ts",
      "security-headers-helper.spec.ts",
    ]) {
      expect(match.test(`/repo/e2e/${other}`), other).toBe(false);
    }
  });

  it("phone-webkit blocks service workers: Playwright's WebKit does not apply route() or setOffline() to a page a worker controls", () => {
    // Evidence (CI 40959570806 and the one before): with a worker in control, route.fulfill/abort/hold on POST /api/sync did not take effect
    // in WebKit (queued ops were applied at once; a held edit was not held). Chromium applies them. Playwright's own advice is to block
    // workers when intercepting requests. The worker is exercised in Chromium (pwa.spec.ts) and on real devices (Gate 3).
    expect(byName("phone-webkit")!.use?.serviceWorkers).toBe("block");
    expect(byName("phone")!.use?.serviceWorkers).toBeUndefined();
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

  it("the order-entry, firing, kitchen, offline, pwa, bill-close, day-close and M25a specs exist", () => {
    for (const spec of [
      "password-login",
      "session-persistence",
      "order-entry",
      "firing",
      "kitchen",
      "offline",
      "pwa",
      "security-headers",
      "bill-close",
      "day-close",
    ]) {
      expect(() =>
        readFileSync(new URL(`../../e2e/${spec}.spec.ts`, import.meta.url)),
      ).not.toThrow();
    }
  });
});

describe("the service worker's own requests are under Playwright's control", () => {
  it("the config switches on service worker network events, so setOffline and routes reach the worker (Chromium)", () => {
    // Without it Playwright's offline mode does not touch the worker's fetches, and an "offline" spec still reads live data.
    expect(process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS).toBe("1");
  });
});

describe("CI installs the WebKit browser next to Chromium", () => {
  const ci = readFileSync(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8");
  const job = ci.slice(ci.indexOf("  supabase:"), ci.indexOf("  t1-spike:"));

  // chore/ci-playwright-cache: on a cache miss the full install, on a hit the system packages only, for the same two
  // browsers (tests/config/ci-playwright-cache.test.ts pins the cache and the conditions).
  it("the supabase job installs chromium and webkit with their system dependencies, before the tests", () => {
    expect(job).toContain("npx playwright install --with-deps chromium webkit");
    expect(job).toContain("npx playwright install-deps chromium webkit");
    expect(job.indexOf("npx playwright install")).toBeLessThan(job.indexOf("npx playwright test"));
    expect(ci.match(/npx playwright install --with-deps/g)).toHaveLength(1);
    expect(ci.match(/npx playwright install-deps/g)).toHaveLength(1);
    expect(ci.match(/npx playwright install/g)).toHaveLength(2);
  });
});

describe("the e2e web server and the sign-in timing floor", () => {
  const config = readFileSync(new URL("../../playwright.config.ts", import.meta.url), "utf8");

  it("switches the floor off for the local test server only, and nowhere else in the repo's runtime config", () => {
    expect(config).toContain('env: { E2E_AUTH_FLOOR_OFF: "1" }');
    for (const file of [".env.example", "vercel.json", "next.config.ts"]) {
      let text = "";
      try {
        text = readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
      } catch {
        continue;
      }
      expect(text, file).not.toContain("E2E_AUTH_FLOOR_OFF");
    }
  });
});
