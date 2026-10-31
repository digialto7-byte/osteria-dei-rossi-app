import { chromium, expect, test } from "@playwright/test";
import {
  COLD_WARM_LOADS,
  SLOW_4G,
  assertStagingTarget,
  measure,
  renderReport,
} from "../../scripts/lib/perf-4g";

// AT7 evidence (M22 plan §5 step 18): time from the start of the navigation to the "Ieri" tile on Oggi, as the owner, through a
// simulated Slow 4G connection, against the STAGING app only. It reports numbers and never fails on one. It runs only from the
// perf-dashboard-4g workflow (which sets the opt-in, the staging host and the signed-in session file); anywhere else it is skipped,
// so `npx playwright test` in CI never reaches staging. The same measurement as scripts/perf/dashboard-4g.ts, on Playwright's runner.

test.skip(
  process.env.PERF_STAGING_OK !== "yes" || !process.env.PERF_4G_STORAGE_STATE,
  "staging timing: started by the founder's workflow only",
);
test.setTimeout(30 * 60_000);

test("dashboard on Slow 4G: cold and warm loads until the Ieri tile is visible", async () => {
  const { baseOrigin } = assertStagingTarget({
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    baseUrl: process.env.BASE_URL ?? "",
    stagingRef: process.env.STAGING_PROJECT_REF ?? "",
    stagingAppHost: process.env.STAGING_APP_HOST ?? "",
  });
  const storageState = process.env.PERF_4G_STORAGE_STATE!;
  const browser = await chromium.launch();

  async function load(warmContext: Awaited<ReturnType<typeof browser.newContext>> | null) {
    const context = warmContext ?? (await browser.newContext({ storageState }));
    try {
      const page = await context.newPage();
      const cdp = await context.newCDPSession(page);
      await cdp.send("Network.enable");
      await cdp.send("Network.emulateNetworkConditions", { offline: false, ...SLOW_4G });
      const started = performance.now();
      await page.goto(`${baseOrigin}/`, { waitUntil: "commit" });
      try {
        await page
          .locator('main [data-tile="yesterday"]')
          .waitFor({ state: "visible", timeout: 30_000 });
      } catch {
        return null;
      }
      return performance.now() - started;
    } finally {
      if (!warmContext) await context.close();
    }
  }

  try {
    const warmContext = await browser.newContext({ storageState });
    await load(warmContext); // primes the cache; not counted
    const samples = await measure({
      provisionOwner: async () => undefined,
      load: (mode) => load(mode === "warm" ? warmContext : null),
    });
    await warmContext.close();
    process.stdout.write(`${renderReport(samples)}\n`);
    expect(samples.cold.length + samples.coldFailures).toBe(COLD_WARM_LOADS);
  } finally {
    await browser.close();
  }
});
